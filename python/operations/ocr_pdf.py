"""``pdf.ocr-searchable`` — add a searchable text layer to a PDF with OCRmyPDF.

Requires the ``ocr`` profile (OCRmyPDF, which orchestrates Tesseract and
Ghostscript). Fills the capability gap the built-in toolchain leaves open
(image-only PDFs -> selectable/searchable text). Output is a PDF.
"""

from __future__ import annotations

import os

from . import (
    OperationArtifact,
    OperationContext,
    OperationResult,
    register_operation,
)


@register_operation("pdf.ocr-searchable")
def ocr_searchable(ctx: OperationContext) -> OperationResult:
    if not ctx.input_paths:
        raise ValueError("pdf.ocr-searchable requires one input PDF")

    try:
        import ocrmypdf  # type: ignore
    except ImportError as err:  # pragma: no cover - exercised only without the profile
        raise ValueError(
            "Searchable OCR requires the ocr profile (OCRmyPDF + Tesseract). "
            "Run: npm run python:install -- --profile ocr"
        ) from err

    language = str(ctx.options.get("language", "eng")) or "eng"
    # skip_text avoids failing on pages that already contain text; force re-OCR
    # only when the caller explicitly asks for it.
    force = bool(ctx.options.get("force", False))

    out_name = "output.pdf"
    out_path = os.path.join(ctx.output_dir, out_name)
    ctx.progress(20, "Running OCR")
    ocrmypdf.ocr(
        ctx.input_paths[0],
        out_path,
        language=language,
        skip_text=not force,
        force_ocr=force,
        progress_bar=False,
    )

    if ctx.is_cancelled():
        raise RuntimeError("Cancelled")

    max_output_bytes = int(ctx.limits.get("maxOutputBytes", 0) or 0)
    if max_output_bytes and os.path.getsize(out_path) > max_output_bytes:
        os.remove(out_path)
        raise ValueError("pdf.ocr-searchable output exceeds the configured size limit")

    ctx.progress(100, "Searchable PDF ready")
    return OperationResult(
        outputs=[OperationArtifact(name=out_name, mime="application/pdf", path=out_path)],
        meta={"engine": "ocrmypdf", "language": language},
    )
