"""Operation registry for the AlphaStudio Python bridge.

Operations register themselves with the ``@register_operation("id")`` decorator
and are looked up by id from ``bridge.py``. Each operation is a callable with the
signature ``handler(ctx: OperationContext) -> OperationResult``.

This module is intentionally dependency-free (stdlib only) so that the
``python-core`` profile works without any pip installs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List


@dataclass
class OperationContext:
    """Inputs handed to an operation handler by the bridge."""

    operation: str
    input_paths: List[str]
    input_names: List[str]
    output_dir: str
    options: Dict[str, object]
    limits: Dict[str, object]
    # Progress reporter: progress(percent: int, message: str) -> None.
    # Writes ALPHA_PROGRESS lines to stderr; never touches stdout.
    progress: Callable[[int, str], None]
    # Cooperative cancellation check (set by the bridge SIGTERM handler).
    is_cancelled: Callable[[], bool]


@dataclass
class OperationArtifact:
    """A single output file produced by an operation."""

    name: str
    mime: str
    path: str


@dataclass
class OperationResult:
    """Return value of an operation handler."""

    outputs: List[OperationArtifact] = field(default_factory=list)
    meta: Dict[str, object] = field(default_factory=dict)


OperationHandler = Callable[[OperationContext], OperationResult]

_REGISTRY: Dict[str, OperationHandler] = {}


def register_operation(operation_id: str) -> Callable[[OperationHandler], OperationHandler]:
    """Decorator: register ``handler`` under ``operation_id``."""

    def decorator(handler: OperationHandler) -> OperationHandler:
        if operation_id in _REGISTRY:
            raise ValueError(f"Duplicate operation id: {operation_id}")
        _REGISTRY[operation_id] = handler
        return handler

    return decorator


def get_operation(operation_id: str) -> OperationHandler:
    """Look up a registered operation or raise ``KeyError``."""
    return _REGISTRY[operation_id]


def list_operations() -> List[str]:
    """Return the sorted ids of all registered operations."""
    return sorted(_REGISTRY.keys())


# Optional third-party modules that heavier profiles provide. Probed with
# importlib.util.find_spec (no import side effects) for capability reporting.
OPTIONAL_MODULES = [
    "pandas",
    "openpyxl",
    "pyarrow",
    "weasyprint",
    "markdown",
    "ocrmypdf",
    "cv2",
    "rembg",
    "faster_whisper",
    "llama_cpp",
]


def capability_report() -> Dict[str, object]:
    """Report interpreter version, optional-module availability, and operations.

    Consumed by the Node engine via `bridge.py --selfcheck` to gate routes that
    require a heavier profile without importing (and paying the cost of) those
    modules here.
    """
    import importlib.util
    import sys

    modules = {
        name: importlib.util.find_spec(name) is not None for name in OPTIONAL_MODULES
    }
    return {
        "python": sys.version.split()[0],
        "modules": modules,
        "operations": list_operations(),
    }


def _load_builtin_operations() -> None:
    """Import modules that self-register operations.

    Kept explicit (no directory scanning) so packaging and static analysis
    stay predictable.
    """
    from . import json_transform  # noqa: F401  (import side effect: registration)
    from . import table_transform  # noqa: F401  (import side effect: registration)
    from . import document_pdf  # noqa: F401  (import side effect: registration)


_load_builtin_operations()
