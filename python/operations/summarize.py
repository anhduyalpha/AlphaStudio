"""``doc.summarize`` — summarize (or answer questions about) a text document.

Optional local-LLM operation using llama-cpp-python (``ai`` profile) with a
GGUF model. Gated on BOTH the package and a locally present ``.gguf`` model in
``.runtime/python/models/llm/``; nothing is ever downloaded during a job. A
custom ``options.prompt`` turns this into document Q&A.

Accepts text-like inputs (txt/md/html/rst/json/csv/tsv). For PDFs, run
``pdf.to-text`` (or the searchable-OCR op) first, then summarize the text.
"""

from __future__ import annotations

import os
from typing import Optional

from . import (
    OperationArtifact,
    OperationContext,
    OperationResult,
    register_operation,
)
from ._models import models_dir

_TEXT_EXTS = {"txt", "md", "markdown", "html", "htm", "rst", "json", "csv", "tsv"}


def _first_gguf(directory: str) -> Optional[str]:
    if not os.path.isdir(directory):
        return None
    matches = sorted(f for f in os.listdir(directory) if f.lower().endswith(".gguf"))
    return os.path.join(directory, matches[0]) if matches else None


@register_operation("doc.summarize")
def summarize(ctx: OperationContext) -> OperationResult:
    if not ctx.input_paths:
        raise ValueError("doc.summarize requires one text input")

    try:
        from llama_cpp import Llama  # type: ignore
    except ImportError as err:  # pragma: no cover - exercised only without the profile
        raise ValueError(
            "Summarization requires the ai profile (llama-cpp-python). "
            "Run: npm run python:install -- --profile ai"
        ) from err

    llm_dir = os.path.join(models_dir(ctx), "llm")
    requested = str(ctx.options.get("model", "") or "")
    model_path = os.path.join(llm_dir, requested) if requested else _first_gguf(llm_dir)
    if not model_path or not os.path.isfile(model_path):
        raise ValueError(
            "No local LLM model found. Place a .gguf model in "
            ".runtime/python/models/llm/ (see docs/python-runtime.md)"
        )

    ext = os.path.splitext(ctx.input_paths[0])[1].lower().lstrip(".")
    if ext == "pdf":
        raise ValueError("Summarize a PDF by extracting text first (pdf.to-text), then summarize the text")
    if ext and ext not in _TEXT_EXTS:
        raise ValueError(f"Unsupported input for summarize: {ext}")

    with open(ctx.input_paths[0], "r", encoding="utf-8", errors="replace") as handle:
        text = handle.read().strip()
    if not text:
        raise ValueError("Input document is empty")

    max_chars = int(ctx.options.get("maxInputChars", 12000) or 12000)
    text = text[:max_chars]
    prompt = str(ctx.options.get("prompt") or "Summarize the following document concisely:")

    ctx.progress(25, "Loading model")
    llm = Llama(model_path=model_path, n_ctx=int(ctx.options.get("nCtx", 4096) or 4096), verbose=False)
    if ctx.is_cancelled():
        raise RuntimeError("Cancelled")

    ctx.progress(55, "Generating")
    completion = llm(
        f"{prompt}\n\n{text}\n\nAnswer:",
        max_tokens=int(ctx.options.get("maxTokens", 512) or 512),
        temperature=float(ctx.options.get("temperature", 0.2) or 0.2),
        stop=["\n\n\n"],
    )
    summary = str(completion["choices"][0]["text"]).strip()
    if not summary:
        raise ValueError("Model returned an empty response")

    out_name = "output.txt"
    out_path = os.path.join(ctx.output_dir, out_name)
    ctx.progress(90, "Writing summary")
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(summary + "\n")

    max_output_bytes = int(ctx.limits.get("maxOutputBytes", 0) or 0)
    if max_output_bytes and os.path.getsize(out_path) > max_output_bytes:
        os.remove(out_path)
        raise ValueError("doc.summarize output exceeds the configured size limit")

    ctx.progress(100, "Summary ready")
    return OperationResult(
        outputs=[OperationArtifact(name=out_name, mime="text/plain", path=out_path)],
        meta={"engine": "llama-cpp", "model": os.path.basename(model_path)},
    )
