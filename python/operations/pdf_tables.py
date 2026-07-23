"""``pdf.extract-tables`` — extract tables from a PDF into CSV files (Camelot).

Requires the ``documents`` profile (camelot-py, which uses OpenCV + Ghostscript).
Emits one CSV per detected table; the Node worker zips multiple artifacts.
"""

from __future__ import annotations

import os

from . import (
    OperationArtifact,
    OperationContext,
    OperationResult,
    register_operation,
)


@register_operation("pdf.extract-tables")
def extract_tables(ctx: OperationContext) -> OperationResult:
    if not ctx.input_paths:
        raise ValueError("pdf.extract-tables requires one input PDF")

    try:
        import camelot  # type: ignore
    except ImportError as err:  # pragma: no cover - exercised only without the profile
        raise ValueError(
            "Table extraction requires the documents profile (camelot-py). "
            "Run: npm run python:install -- --profile documents"
        ) from err

    pages = str(ctx.options.get("pages", "all")) or "all"
    flavor = str(ctx.options.get("flavor", "lattice"))
    if flavor not in {"lattice", "stream"}:
        flavor = "lattice"

    ctx.progress(30, "Detecting tables")
    tables = camelot.read_pdf(ctx.input_paths[0], pages=pages, flavor=flavor)
    if len(tables) == 0:
        raise ValueError("No tables were detected in the PDF")

    outputs = []
    max_output_bytes = int(ctx.limits.get("maxOutputBytes", 0) or 0)
    total = 0
    for index, table in enumerate(tables):
        name = f"table-{index + 1}.csv"
        path = os.path.join(ctx.output_dir, name)
        table.to_csv(path)
        total += os.path.getsize(path)
        if max_output_bytes and total > max_output_bytes:
            raise ValueError("pdf.extract-tables output exceeds the configured size limit")
        outputs.append(OperationArtifact(name=name, mime="text/csv", path=path))

    ctx.progress(100, f"Extracted {len(outputs)} table(s)")
    return OperationResult(outputs=outputs, meta={"engine": "camelot", "tables": len(outputs)})
