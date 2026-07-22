"""``media.transcribe`` — transcribe audio/video to txt / srt / vtt (faster-whisper).

Requires the ``ai`` profile (faster-whisper) AND a locally installed Whisper
model. Models are never downloaded during a job: if the requested model is not
present the operation fails with a ``npm run python:models`` hint. Output format
is chosen by ``options.format`` (txt default, or srt/vtt subtitles).
"""

from __future__ import annotations

import os
from typing import List

from . import (
    OperationArtifact,
    OperationContext,
    OperationResult,
    register_operation,
)
from ._models import models_dir

_MIME = {"txt": "text/plain", "srt": "application/x-subrip", "vtt": "text/vtt"}


def _timestamp(seconds: float, vtt: bool) -> str:
    if seconds < 0:
        seconds = 0.0
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    sep = "." if vtt else ","
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{sep}{millis:03d}"


def _render(segments: List[dict], fmt: str) -> str:
    if fmt == "txt":
        return "\n".join(seg["text"].strip() for seg in segments) + "\n"
    lines: List[str] = []
    if fmt == "vtt":
        lines.append("WEBVTT")
        lines.append("")
    for index, seg in enumerate(segments, start=1):
        if fmt == "srt":
            lines.append(str(index))
        lines.append(f"{_timestamp(seg['start'], fmt == 'vtt')} --> {_timestamp(seg['end'], fmt == 'vtt')}")
        lines.append(seg["text"].strip())
        lines.append("")
    return "\n".join(lines)


@register_operation("media.transcribe")
def transcribe(ctx: OperationContext) -> OperationResult:
    if not ctx.input_paths:
        raise ValueError("media.transcribe requires one audio/video input")

    fmt = str(ctx.options.get("format", "txt")).lower().lstrip(".")
    if fmt not in _MIME:
        raise ValueError(f"Unsupported transcript/subtitle format: {fmt}")

    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as err:  # pragma: no cover - exercised only without the profile
        raise ValueError(
            "Transcription requires the ai profile (faster-whisper). "
            "Run: npm run python:install -- --profile ai"
        ) from err

    model_size = str(ctx.options.get("model", "base"))
    root = models_dir(ctx)
    ctx.progress(15, "Loading model")
    try:
        # local_files_only: never reach out to the network during a job.
        model = WhisperModel(
            model_size, download_root=root, local_files_only=True,
            device="cpu", compute_type="int8",
        )
    except Exception as err:
        raise ValueError(
            f"Whisper model '{model_size}' is not installed. "
            f"Run: npm run python:models -- --model whisper-{model_size}"
        ) from err

    ctx.progress(35, "Transcribing")
    segments_iter, _info = model.transcribe(ctx.input_paths[0], language=ctx.options.get("language"))
    segments = [{"start": s.start, "end": s.end, "text": s.text} for s in segments_iter]
    if ctx.is_cancelled():
        raise RuntimeError("Cancelled")
    if not segments:
        raise ValueError("No speech was detected in the input")

    out_name = f"output.{fmt}"
    out_path = os.path.join(ctx.output_dir, out_name)
    ctx.progress(85, "Writing transcript")
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(_render(segments, fmt))

    max_output_bytes = int(ctx.limits.get("maxOutputBytes", 0) or 0)
    if max_output_bytes and os.path.getsize(out_path) > max_output_bytes:
        os.remove(out_path)
        raise ValueError("media.transcribe output exceeds the configured size limit")

    ctx.progress(100, "Transcription complete")
    return OperationResult(
        outputs=[OperationArtifact(name=out_name, mime=_MIME[fmt], path=out_path)],
        meta={"engine": "faster-whisper", "model": model_size, "segments": len(segments)},
    )
