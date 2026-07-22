"""Shared helper: resolve the local model directory for AI/vision operations.

Models are NEVER downloaded during a job. The Node worker injects
``options.modelsDir`` (``.runtime/python/models``); operations check for a
locally present model and fail with an actionable ``npm run python:models``
hint when it is missing.
"""

from __future__ import annotations

import os


def models_dir(ctx) -> str:
    configured = ctx.options.get("modelsDir")
    if isinstance(configured, str) and configured:
        return configured
    here = os.path.dirname(os.path.abspath(__file__))          # python/operations
    root = os.path.dirname(os.path.dirname(here))               # repo root
    return os.path.join(root, ".runtime", "python", "models")
