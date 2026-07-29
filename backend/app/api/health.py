"""Health and readiness endpoints."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import RedirectResponse

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


@router.get(
    "/",
    response_model=None,
    summary="Redirect to the web client, or return a liveness payload",
)
def read_root(settings: SettingsDep) -> RootResponse | RedirectResponse:
    """Send visitors to the web client, or report liveness.

    When the client is served and ``root_redirect_to_ui`` is on, a bare domain
    such as ``https://myeye.example.ac.th/`` lands on the landing page instead
    of a JSON blob. The redirect is relative, so it works behind a reverse
    proxy without the app needing to know its public scheme or host.

    ``/health`` is unaffected and remains the endpoint to probe for monitoring.

    Args:
        settings: Injected application settings.

    Returns:
        RootResponse | RedirectResponse: The liveness payload, or a redirect to
        the mounted client.
    """
    if settings.root_redirect_to_ui and settings.serve_frontend:
        return RedirectResponse(f"{settings.frontend_mount_path.rstrip('/')}/", status_code=307)

    return RootResponse(
        status="ok",
        app=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
        docs_url=settings.docs_url,
        ui_url=settings.frontend_mount_path if settings.serve_frontend else None,
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
