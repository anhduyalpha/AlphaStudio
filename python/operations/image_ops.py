"""Vision operations backed by OpenCV (``vision`` profile).

* ``image.deskew``   — straighten a rotated/skewed scan.
* ``image.autocrop`` — trim uniform borders to the content bounding box.

Both preserve the input image format. OpenCV (``cv2``) and NumPy come from the
vision profile; without it the operations fail with an actionable message.
"""

from __future__ import annotations

import os
from typing import Tuple

from . import (
    OperationArtifact,
    OperationContext,
    OperationResult,
    register_operation,
)

_IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}


def _load_cv2():
    try:
        import cv2  # type: ignore
        import numpy  # type: ignore
    except ImportError as err:  # pragma: no cover - exercised only without the profile
        raise ValueError(
            "Image vision operations require the vision profile (OpenCV). "
            "Run: npm run python:install -- --profile vision"
        ) from err
    return cv2, numpy


def _read_image(cv2, path: str):
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not read the input image")
    return image


def _output(ctx: OperationContext, source_path: str) -> Tuple[str, str, str]:
    ext = os.path.splitext(source_path)[1].lower() or ".png"
    if ext not in _IMAGE_MIME:
        raise ValueError(f"Unsupported image extension for vision op: {ext}")
    name = f"output{ext}"
    return name, os.path.join(ctx.output_dir, name), _IMAGE_MIME[ext]


def _finish(ctx: OperationContext, out_path: str) -> None:
    max_output_bytes = int(ctx.limits.get("maxOutputBytes", 0) or 0)
    if max_output_bytes and os.path.getsize(out_path) > max_output_bytes:
        os.remove(out_path)
        raise ValueError("Vision output exceeds the configured size limit")


@register_operation("image.deskew")
def deskew(ctx: OperationContext) -> OperationResult:
    if not ctx.input_paths:
        raise ValueError("image.deskew requires one input image")
    cv2, np = _load_cv2()
    source = ctx.input_paths[0]
    image = _read_image(cv2, source)

    ctx.progress(35, "Estimating skew angle")
    gray = cv2.bitwise_not(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY))
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    if coords.size == 0:
        raise ValueError("Image appears blank; nothing to deskew")
    angle = cv2.minAreaRect(coords)[-1]
    angle = -(90 + angle) if angle < -45 else -angle

    (height, width) = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width // 2, height // 2), angle, 1.0)
    rotated = cv2.warpAffine(
        image, matrix, (width, height),
        flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE,
    )

    name, out_path, mime = _output(ctx, source)
    ctx.progress(85, "Writing image")
    cv2.imwrite(out_path, rotated)
    _finish(ctx, out_path)
    ctx.progress(100, "Deskew complete")
    return OperationResult(
        outputs=[OperationArtifact(name=name, mime=mime, path=out_path)],
        meta={"engine": "opencv", "angleDegrees": round(float(angle), 3)},
    )


@register_operation("image.autocrop")
def autocrop(ctx: OperationContext) -> OperationResult:
    if not ctx.input_paths:
        raise ValueError("image.autocrop requires one input image")
    cv2, np = _load_cv2()
    source = ctx.input_paths[0]
    image = _read_image(cv2, source)

    ctx.progress(40, "Finding content bounds")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _thr, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    coords = cv2.findNonZero(binary)
    if coords is None:
        raise ValueError("Image appears uniform; nothing to crop")
    x, y, w, h = cv2.boundingRect(coords)
    cropped = image[y : y + h, x : x + w]

    name, out_path, mime = _output(ctx, source)
    ctx.progress(85, "Writing image")
    cv2.imwrite(out_path, cropped)
    _finish(ctx, out_path)
    ctx.progress(100, "Autocrop complete")
    return OperationResult(
        outputs=[OperationArtifact(name=name, mime=mime, path=out_path)],
        meta={"engine": "opencv", "box": [int(x), int(y), int(w), int(h)]},
    )
