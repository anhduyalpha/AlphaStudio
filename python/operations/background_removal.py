"""``image.background-removal`` — remove an image background with rembg (u2net).

Requires the ``vision`` profile (rembg + onnxruntime) AND a locally installed
u2net model. The model is never downloaded during a job: if it is missing the
operation fails with a ``npm run python:models`` hint. Output is a transparent PNG.
"""

from __future__ import annotations

import os

from . import (
    OperationArtifact,
    OperationContext,
    OperationResult,
    register_operation,
)
from ._models import models_dir


@register_operation("image.background-removal")
def background_removal(ctx: OperationContext) -> OperationResult:
    if not ctx.input_paths:
        raise ValueError("image.background-removal requires one input image")

    root = models_dir(ctx)
    u2net_home = os.path.join(root, "u2net")
    model_file = os.path.join(u2net_home, "u2net.onnx")

    try:
        from rembg import remove  # type: ignore
    except ImportError as err:  # pragma: no cover - exercised only without the profile
        raise ValueError(
            "Background removal requires the vision profile (rembg). "
            "Run: npm run python:install -- --profile vision"
        ) from err

    if not os.path.isfile(model_file):
        raise ValueError(
            "Background-removal model is not installed. "
            "Run: npm run python:models -- --model u2net"
        )
    # Point rembg at the local model dir so it never attempts a network download.
    os.environ.setdefault("U2NET_HOME", u2net_home)

    ctx.progress(30, "Removing background")
    with open(ctx.input_paths[0], "rb") as handle:
        result_bytes = remove(handle.read())

    if ctx.is_cancelled():
        raise RuntimeError("Cancelled")

    out_name = "output.png"
    out_path = os.path.join(ctx.output_dir, out_name)
    ctx.progress(85, "Writing image")
    with open(out_path, "wb") as handle:
        handle.write(result_bytes)

    max_output_bytes = int(ctx.limits.get("maxOutputBytes", 0) or 0)
    if max_output_bytes and os.path.getsize(out_path) > max_output_bytes:
        os.remove(out_path)
        raise ValueError("image.background-removal output exceeds the configured size limit")

    ctx.progress(100, "Background removed")
    return OperationResult(
        outputs=[OperationArtifact(name=out_name, mime="image/png", path=out_path)],
        meta={"engine": "rembg", "model": "u2net"},
    )
