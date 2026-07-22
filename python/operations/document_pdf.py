"""``document.to-pdf`` — render Markdown or HTML to PDF with WeasyPrint.

Requires the ``documents`` profile: WeasyPrint (and ``markdown`` for Markdown
input). This provides higher-fidelity typography than the built-in pdf-lib
text path; the built-in route remains the fallback when the profile is absent.

WeasyPrint pulls in native libraries (Pango/Cairo) that can be awkward to
install on Windows. Availability is advertised from ``find_spec``; if the
native stack is broken at runtime this operation fails with a clear error and
the built-in engine still handles md/html -> pdf.
"""

from __future__ import annotations

import os

from . import (
    OperationArtifact,
    OperationContext,
    OperationResult,
    register_operation,
)


def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def _markdown_to_html(text: str) -> str:
    try:
        import markdown  # type: ignore
    except ImportError as err:  # pragma: no cover - exercised only without the profile
        raise ValueError(
            "Markdown to PDF requires the documents profile. "
            "Run: npm run python:install -- --profile documents"
        ) from err
    body = markdown.markdown(text, extensions=["tables", "fenced_code", "toc"])
    return f"<!doctype html><html><head><meta charset='utf-8'></head><body>{body}</body></html>"


@register_operation("document.to-pdf")
def document_to_pdf(ctx: OperationContext) -> OperationResult:
    if not ctx.input_paths:
        raise ValueError("document.to-pdf requires one input file")

    source_path = ctx.input_paths[0]
    ext = os.path.splitext(source_path)[1].lower().lstrip(".")

    ctx.progress(20, "Reading document")
    text = _read_text(source_path)
    html = _markdown_to_html(text) if ext in {"md", "markdown"} else text

    if ctx.is_cancelled():
        raise RuntimeError("Cancelled")

    try:
        from weasyprint import HTML  # type: ignore
    except ImportError as err:  # pragma: no cover - exercised only without the profile
        raise ValueError(
            "HTML/Markdown to PDF requires the documents profile (WeasyPrint). "
            "Run: npm run python:install -- --profile documents"
        ) from err

    out_name = "output.pdf"
    out_path = os.path.join(ctx.output_dir, out_name)
    ctx.progress(70, "Rendering PDF")
    # base_url confines relative asset resolution to the isolated output dir.
    HTML(string=html, base_url=ctx.output_dir).write_pdf(out_path)

    max_output_bytes = int(ctx.limits.get("maxOutputBytes", 0) or 0)
    written = os.path.getsize(out_path)
    if max_output_bytes and written > max_output_bytes:
        os.remove(out_path)
        raise ValueError("document.to-pdf output exceeds the configured size limit")

    ctx.progress(100, "PDF ready")
    return OperationResult(
        outputs=[OperationArtifact(name=out_name, mime="application/pdf", path=out_path)],
        meta={"engine": "weasyprint", "source": ext},
    )
