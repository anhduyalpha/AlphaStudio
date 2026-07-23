"""``data.json-transform`` — convert JSON to CSV or TSV.

Deterministic and stdlib-only (``json`` + ``csv``). Accepts:

* a list of objects  -> columns are the union of keys (first-seen order)
* a list of lists    -> written verbatim, row by row
* a list of scalars  -> single ``value`` column
* a single object    -> one header row + one data row

Nested values (dict/list) are serialized to compact JSON text within the cell.
"""

from __future__ import annotations

import csv
import json
import os
from typing import Dict, List

from . import (
    OperationArtifact,
    OperationContext,
    OperationResult,
    register_operation,
)

_DELIMITERS = {"csv": ",", "tsv": "\t"}
_MIME = {"csv": "text/csv", "tsv": "text/tab-separated-values"}


def _cell(value: object) -> str:
    """Render one JSON value as a flat CSV/TSV cell."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value)
    # dict / list -> compact JSON so the cell stays single-valued
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _rows_from_payload(payload: object) -> List[List[str]]:
    """Normalize an arbitrary JSON payload into a header + data rows matrix."""
    if isinstance(payload, dict):
        payload = [payload]

    if not isinstance(payload, list):
        # scalar top-level value
        return [["value"], [_cell(payload)]]

    if len(payload) == 0:
        return [["value"]]

    # list of lists -> verbatim
    if all(isinstance(item, list) for item in payload):
        return [[_cell(cell) for cell in row] for row in payload]

    # list of objects -> union of keys in first-seen order
    if all(isinstance(item, dict) for item in payload):
        columns: List[str] = []
        seen: Dict[str, bool] = {}
        for item in payload:
            for key in item.keys():
                if key not in seen:
                    seen[key] = True
                    columns.append(str(key))
        rows: List[List[str]] = [columns]
        for item in payload:
            rows.append([_cell(item.get(col)) for col in columns])
        return rows

    # list of scalars (or mixed) -> single column
    return [["value"], *[[_cell(item)] for item in payload]]


@register_operation("data.json-transform")
def json_transform(ctx: OperationContext) -> OperationResult:
    if not ctx.input_paths:
        raise ValueError("json-transform requires one input file")

    fmt = str(ctx.options.get("format", "csv")).lower().lstrip(".")
    if fmt not in _DELIMITERS:
        raise ValueError(f"Unsupported target format for json-transform: {fmt}")

    ctx.progress(10, "Reading JSON input")
    with open(ctx.input_paths[0], "r", encoding="utf-8") as handle:
        try:
            payload = json.load(handle)
        except json.JSONDecodeError as err:
            raise ValueError(f"Input is not valid JSON: {err}") from err

    if ctx.is_cancelled():
        raise RuntimeError("Cancelled")

    ctx.progress(45, "Transforming rows")
    rows = _rows_from_payload(payload)

    if ctx.is_cancelled():
        raise RuntimeError("Cancelled")

    out_name = f"output.{fmt}"
    out_path = os.path.join(ctx.output_dir, out_name)
    ctx.progress(80, "Writing output")
    # newline="" is required for the csv module to control line endings itself.
    with open(out_path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter=_DELIMITERS[fmt], lineterminator="\n")
        writer.writerows(rows)

    max_output_bytes = int(ctx.limits.get("maxOutputBytes", 0) or 0)
    written = os.path.getsize(out_path)
    if max_output_bytes and written > max_output_bytes:
        os.remove(out_path)
        raise ValueError("json-transform output exceeds the configured size limit")

    ctx.progress(100, "Conversion complete")
    data_rows = max(0, len(rows) - 1)
    return OperationResult(
        outputs=[OperationArtifact(name=out_name, mime=_MIME[fmt], path=out_path)],
        meta={"rows": data_rows, "columns": len(rows[0]) if rows else 0, "format": fmt},
    )
