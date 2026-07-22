"""``data.table-transform`` — convert between tabular formats.

Source format is inferred from the input file extension; target from
``options.format``. CSV/TSV/JSON are handled with the standard library (no
extra dependencies), so csv->json and tsv->json work on the core profile.
XLSX and Parquet require the ``data`` profile (pandas + openpyxl / pyarrow) and
raise a clear, actionable error when that profile is not installed.

Routes that another engine already owns (e.g. csv<->xlsx via LibreOffice,
csv<->tsv via the built-in engine) are intentionally NOT advertised here; this
operation only fills gaps (anything <-> JSON, and Parquet).
"""

from __future__ import annotations

import csv
import json
import os
from typing import Dict, List, Tuple

from . import (
    OperationArtifact,
    OperationContext,
    OperationResult,
    register_operation,
)

_DELIMITERS = {"csv": ",", "tsv": "\t"}
_MIME = {
    "csv": "text/csv",
    "tsv": "text/tab-separated-values",
    "json": "application/json",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "parquet": "application/vnd.apache.parquet",
}
_STDLIB_FORMATS = {"csv", "tsv", "json"}
_PANDAS_FORMATS = {"xlsx", "parquet"}
_SUPPORTED = _STDLIB_FORMATS | _PANDAS_FORMATS

Records = List[Dict[str, object]]


def _require_pandas(fmt: str):
    try:
        import pandas  # type: ignore
    except ImportError as err:  # pragma: no cover - exercised only without the profile
        raise ValueError(
            f"{fmt} conversion requires the data profile. "
            "Run: npm run python:install -- --profile data"
        ) from err
    return pandas


def _cell(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value)
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _read_delimited(path: str, delimiter: str) -> Tuple[List[str], Records]:
    with open(path, "r", encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle, delimiter=delimiter))
    if not rows:
        return [], []
    columns = [str(col) for col in rows[0]]
    records = [dict(zip(columns, row)) for row in rows[1:]]
    return columns, records


def _read_json(path: str) -> Tuple[List[str], Records]:
    with open(path, "r", encoding="utf-8") as handle:
        try:
            payload = json.load(handle)
        except json.JSONDecodeError as err:
            raise ValueError(f"Input is not valid JSON: {err}") from err
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        return ["value"], [{"value": payload}]
    if payload and all(isinstance(item, dict) for item in payload):
        columns: List[str] = []
        seen: Dict[str, bool] = {}
        for item in payload:
            for key in item.keys():
                if key not in seen:
                    seen[key] = True
                    columns.append(str(key))
        return columns, [dict(item) for item in payload]
    if payload and all(isinstance(item, list) for item in payload):
        columns = [str(col) for col in payload[0]]
        return columns, [dict(zip(columns, row)) for row in payload[1:]]
    return ["value"], [{"value": item} for item in payload]


def _read_pandas(path: str, fmt: str) -> Tuple[List[str], Records]:
    pandas = _require_pandas(fmt)
    frame = pandas.read_excel(path) if fmt == "xlsx" else pandas.read_parquet(path)
    frame = frame.where(pandas.notnull(frame), None)
    columns = [str(col) for col in frame.columns]
    return columns, frame.to_dict("records")


def _read_source(path: str, fmt: str) -> Tuple[List[str], Records]:
    if fmt in _DELIMITERS:
        return _read_delimited(path, _DELIMITERS[fmt])
    if fmt == "json":
        return _read_json(path)
    return _read_pandas(path, fmt)


def _write_delimited(columns: List[str], records: Records, out_path: str, delimiter: str) -> None:
    with open(out_path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter=delimiter, lineterminator="\n")
        writer.writerow(columns)
        for record in records:
            writer.writerow([_cell(record.get(col)) for col in columns])


def _write_json(records: Records, out_path: str) -> None:
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(records, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def _write_pandas(columns: List[str], records: Records, out_path: str, fmt: str) -> None:
    pandas = _require_pandas(fmt)
    frame = pandas.DataFrame(records, columns=columns or None)
    if fmt == "xlsx":
        frame.to_excel(out_path, index=False)
    else:
        frame.to_parquet(out_path, index=False)


@register_operation("data.table-transform")
def table_transform(ctx: OperationContext) -> OperationResult:
    if not ctx.input_paths:
        raise ValueError("table-transform requires one input file")

    source_fmt = str(ctx.options.get("from") or "").lower().lstrip(".")
    if not source_fmt:
        source_fmt = os.path.splitext(ctx.input_paths[0])[1].lower().lstrip(".")
    target_fmt = str(ctx.options.get("format", "")).lower().lstrip(".")

    if source_fmt not in _SUPPORTED:
        raise ValueError(f"Unsupported source format for table-transform: {source_fmt or '(none)'}")
    if target_fmt not in _SUPPORTED:
        raise ValueError(f"Unsupported target format for table-transform: {target_fmt or '(none)'}")
    if source_fmt == target_fmt:
        raise ValueError("Source and target formats are identical")

    ctx.progress(15, f"Reading {source_fmt}")
    columns, records = _read_source(ctx.input_paths[0], source_fmt)
    if ctx.is_cancelled():
        raise RuntimeError("Cancelled")

    out_name = f"output.{target_fmt}"
    out_path = os.path.join(ctx.output_dir, out_name)
    ctx.progress(70, f"Writing {target_fmt}")
    if target_fmt in _DELIMITERS:
        _write_delimited(columns, records, out_path, _DELIMITERS[target_fmt])
    elif target_fmt == "json":
        _write_json(records, out_path)
    else:
        _write_pandas(columns, records, out_path, target_fmt)

    max_output_bytes = int(ctx.limits.get("maxOutputBytes", 0) or 0)
    written = os.path.getsize(out_path)
    if max_output_bytes and written > max_output_bytes:
        os.remove(out_path)
        raise ValueError("table-transform output exceeds the configured size limit")

    ctx.progress(100, "Conversion complete")
    return OperationResult(
        outputs=[OperationArtifact(name=out_name, mime=_MIME[target_fmt], path=out_path)],
        meta={"rows": len(records), "columns": len(columns), "from": source_fmt, "to": target_fmt},
    )
