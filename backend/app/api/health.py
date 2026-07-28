"""Health and readiness endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from app.ai.base import available_models
from app.dependencies import (
    DatabaseDep,
    DatasetRepositoryDep,
    HistoryRepositoryDep,
    PredictorDep,
    SettingsDep,
)
from app.logging_config import get_logger
from app.schemas import HealthResponse, RootResponse

logger = get_logger(__name__)

router = APIRouter(tags=["health"])


@router.get("/", response_model=RootResponse, summary="Service liveness probe")
def read_root(settings: SettingsDep) -> RootResponse:
    """Return a minimal liveness payload.

    Args:
        settings: Injected application settings.

    Returns:
        RootResponse: Service name, version and documentation URL.
    """
    return RootResponse(
        status="ok",
        app=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
        docs_url=settings.docs_url,
    )


@router.get("/health", response_model=HealthResponse, summary="Service readiness probe")
def read_health(
    settings: SettingsDep,
    database: DatabaseDep,
    predictor: PredictorDep,
    dataset_repository: DatasetRepositoryDep,
    history_repository: HistoryRepositoryDep,
) -> HealthResponse:
    """Report the state of every dependency the API needs to serve traffic.

    Args:
        settings: Injected application settings.
        database: Injected database handle.
        predictor: Injected shared predictor.
        dataset_repository: Injected dataset repository.
        history_repository: Injected ``test_history`` repository.

    Returns:
        HealthResponse: Database reachability, model availability and counters.
    """
    database_ok = database.healthy()
    model_info = predictor.info()

    try:
        history_count = history_repository.count() if database_ok else 0
    except Exception:  # pragma: no cover - defensive, health must never raise
        logger.warning("Could not count the assessment history", exc_info=True)
        history_count = 0

    return HealthResponse(
        status="ok" if database_ok else "degraded",
        app=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
        database=database_ok,
        model_available=bool(model_info.get("available")),
        model_type=model_info.get("model_type"),
        dataset=dataset_repository.summary(),
        available_models=available_models(),
        history_count=history_count,
    )
