#!/usr/bin/env python3
"""AlphaStudio Python bridge — one-shot CLI invoked by the Node worker.

Contract (see server/src/convert/engines/python.ts):

  python bridge.py --operation <id> --input <path> [--input <path> ...]
                   --output-dir <dir> --options <json> --limits <json>

* Progress is written to STDERR as ``ALPHA_PROGRESS:<0-100>:<message>`` lines.
* On success the single-line JSON result is written to STDOUT and exit code 0.
* On failure a human-readable message is written to STDERR and exit code 1.
* All output files must live inside ``--output-dir`` (validated here and again
  on the Node side). No network access is performed.

The bridge is dependency-free; only the operation modules may require a heavier
Python profile.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import threading

# Allow running both as "python bridge.py" and "python -m bridge".
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from operations import (  # noqa: E402  (path setup must precede import)
    OperationArtifact,
    OperationContext,
    OperationResult,
    capability_report,
    get_operation,
    list_operations,
)

PROTOCOL_VERSION = 1

_cancelled = threading.Event()


def _install_signal_handlers() -> None:
    def handler(_signum: int, _frame: object) -> None:
        _cancelled.set()

    for name in ("SIGTERM", "SIGINT"):
        sig = getattr(signal, name, None)
        if sig is not None:
            try:
                signal.signal(sig, handler)
            except (ValueError, OSError):
                # Signal handling may be unavailable on some platforms/threads.
                pass


def _emit_progress(percent: int, message: str) -> None:
    clamped = max(0, min(100, int(percent)))
    text = str(message or "").replace("\r", " ").replace("\n", " ")[:200]
    sys.stderr.write(f"ALPHA_PROGRESS:{clamped}:{text}\n")
    sys.stderr.flush()


def _apply_memory_limit(limits: dict) -> None:
    """Best-effort address-space cap on POSIX. No-op on Windows."""
    max_mb = int(limits.get("maxMemoryMb", 0) or 0)
    if max_mb <= 0 or sys.platform == "win32":
        return
    try:
        import resource  # POSIX only

        soft_bytes = max_mb * 1024 * 1024
        _soft, hard = resource.getrlimit(resource.RLIMIT_AS)
        ceiling = soft_bytes if hard == resource.RLIM_INFINITY else min(soft_bytes, hard)
        resource.setrlimit(resource.RLIMIT_AS, (ceiling, hard))
    except Exception:
        # Non-fatal: the Node-side timeout and output-size checks still apply.
        pass


def _validate_output_confined(output_dir: str, artifact: OperationArtifact) -> None:
    root = os.path.realpath(output_dir)
    target = os.path.realpath(artifact.path)
    if os.path.commonpath([root, target]) != root:
        raise ValueError("Operation produced a file outside the output directory")
    if not os.path.isfile(target):
        raise ValueError("Operation reported an output file that does not exist")


def _parse_args(argv: list) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="bridge.py", add_help=True)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--input", action="append", default=[])
    parser.add_argument("--input-name", action="append", default=[])
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--options", default="{}")
    parser.add_argument("--limits", default="{}")
    return parser.parse_args(argv)


def main(argv: list) -> int:
    _install_signal_handlers()

    if "--selfcheck" in argv:
        report = {"protocol": PROTOCOL_VERSION, **capability_report()}
        sys.stdout.write(json.dumps(report, ensure_ascii=False))
        sys.stdout.flush()
        return 0

    args = _parse_args(argv)

    try:
        options = json.loads(args.options or "{}")
        limits = json.loads(args.limits or "{}")
        if not isinstance(options, dict) or not isinstance(limits, dict):
            raise ValueError("--options and --limits must be JSON objects")
    except json.JSONDecodeError as err:
        sys.stderr.write(f"Invalid JSON argument: {err}\n")
        return 1

    output_dir = os.path.realpath(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)
    _apply_memory_limit(limits)

    try:
        handler = get_operation(args.operation)
    except KeyError:
        sys.stderr.write(
            f"Unknown operation '{args.operation}'. Available: {', '.join(list_operations())}\n"
        )
        return 1

    input_names = args.input_name or [os.path.basename(p) for p in args.input]
    ctx = OperationContext(
        operation=args.operation,
        input_paths=[os.path.realpath(p) for p in args.input],
        input_names=input_names,
        output_dir=output_dir,
        options=options,
        limits=limits,
        progress=_emit_progress,
        is_cancelled=_cancelled.is_set,
    )

    try:
        result = handler(ctx)
    except Exception as err:  # noqa: BLE001 (surface a single-line reason to Node)
        if _cancelled.is_set():
            sys.stderr.write("Cancelled\n")
            return 1
        message = str(err) or err.__class__.__name__
        sys.stderr.write(message.replace("\r", " ").replace("\n", " ")[:500] + "\n")
        return 1

    if not isinstance(result, OperationResult) or not result.outputs:
        sys.stderr.write("Operation produced no output\n")
        return 1

    for artifact in result.outputs:
        _validate_output_confined(output_dir, artifact)

    payload = {
        "protocol": PROTOCOL_VERSION,
        "outputs": [
            {"name": a.name, "mime": a.mime, "path": a.path} for a in result.outputs
        ],
        "meta": result.meta,
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
