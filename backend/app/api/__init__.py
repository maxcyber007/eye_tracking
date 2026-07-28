"""API layer: thin HTTP handlers delegating to the AI and persistence layers."""

from __future__ import annotations

from fastapi import APIRouter

from app.api import health, predict, train, upload
from app.config import get_settings


def build_api_router() -> APIRouter:
    """Assemble the versioned API router mounted under the configured prefix.

    Returns:
        fastapi.APIRouter: Router aggregating the upload, train and predict routes.
    """
    router = APIRouter(prefix=get_settings().api_prefix)
    router.include_router(upload.router)
    router.include_router(train.router)
    router.include_router(predict.router)
    return router


__all__ = ["build_api_router", "health", "predict", "train", "upload"]
