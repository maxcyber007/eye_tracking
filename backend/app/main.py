"""FastAPI application factory and entry point.

Run with::

    uvicorn app.main:app --reload

Swagger UI is served at ``/docs`` and ReDoc at ``/redoc``.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import build_api_router, health
from app.config import Settings, get_settings
from app.database import init_database
from app.exceptions import EyeTrackingError
from app.logging_config import configure_logging, get_logger

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    """Prepare and tear down the process-wide resources.

    On start-up the managed directories are created and the SQLite schema is
    migrated; on shutdown a log line marks the clean exit.

    Args:
        application: The FastAPI application being started.

    Yields:
        None: Control is handed back to the server while it serves traffic.
    """
    settings: Settings = application.state.settings
    logger.info("Starting %s v%s (%s)", settings.app_name, settings.app_version, settings.environment)

    settings.ensure_directories()
    init_database(settings)

    logger.info("Upload dir : %s", settings.upload_dir)
    logger.info("Model path : %s", settings.model_path)
    logger.info("Dataset    : %s", settings.dataset_path)
    logger.info("Database   : %s", settings.database_path)
    logger.info("Swagger UI : http://%s:%d%s", settings.host, settings.port, settings.docs_url)

    try:
        yield
    finally:
        logger.info("Shutting down %s", settings.app_name)


def register_exception_handlers(application: FastAPI) -> None:
    """Attach the handlers that turn exceptions into the uniform error envelope.

    Args:
        application: Application to attach the handlers to.

    Returns:
        None
    """

    @application.exception_handler(EyeTrackingError)
    async def handle_domain_error(request: Request, exc: EyeTrackingError) -> JSONResponse:
        """Translate a domain error into its declared HTTP status code.

        Args:
            request: Incoming request, used for logging only.
            exc: The domain error that was raised.

        Returns:
            fastapi.responses.JSONResponse: Uniform error envelope.
        """
        logger.warning("%s on %s: %s", type(exc).__name__, request.url.path, exc.message)
        return JSONResponse(
            status_code=exc.status_code,
            content={"success": False, **exc.to_dict()},
        )

    @application.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Translate a request validation failure into the error envelope.

        Args:
            request: Incoming request, used for logging only.
            exc: The validation error raised by FastAPI.

        Returns:
            fastapi.responses.JSONResponse: Uniform error envelope with details.
        """
        logger.warning("Validation error on %s: %s", request.url.path, exc.errors())
        return JSONResponse(
            status_code=422,
            content={
                "success": False,
                "error": "RequestValidationError",
                "message": "The request payload did not pass validation.",
                "details": {"errors": jsonable_errors(exc)},
            },
        )

    @application.exception_handler(StarletteHTTPException)
    async def handle_http_exception(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        """Translate a framework HTTP error into the error envelope.

        Args:
            request: Incoming request, used for logging only.
            exc: The HTTP exception raised by Starlette or FastAPI.

        Returns:
            fastapi.responses.JSONResponse: Uniform error envelope.
        """
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "error": "HTTPException",
                "message": str(exc.detail),
                "details": {"path": request.url.path},
            },
        )

    @application.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        """Catch-all handler so an unexpected bug never leaks a stack trace.

        Args:
            request: Incoming request, used for logging only.
            exc: The unhandled exception.

        Returns:
            fastapi.responses.JSONResponse: Uniform error envelope with status 500.
        """
        logger.exception("Unhandled error on %s: %s", request.url.path, exc)
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "InternalServerError",
                "message": "An unexpected error occurred while processing the request.",
                "details": {},
            },
        )


def jsonable_errors(exc: RequestValidationError) -> list[dict[str, object]]:
    """Convert validation errors into a JSON-serialisable structure.

    Pydantic attaches the offending input to each error, which may contain
    non-serialisable objects such as ``UploadFile``; those are stringified.

    Args:
        exc: The validation error raised by FastAPI.

    Returns:
        list[dict[str, object]]: Sanitised error entries.
    """
    sanitised: list[dict[str, object]] = []
    for error in exc.errors():
        entry = {key: value for key, value in error.items() if key != "ctx"}
        if "input" in entry and not isinstance(entry["input"], (str, int, float, bool, type(None))):
            entry["input"] = str(entry["input"])
        entry["loc"] = [str(part) for part in error.get("loc", ())]
        sanitised.append(entry)
    return sanitised


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build and configure the FastAPI application.

    Args:
        settings: Optional settings override, mainly used by tests.

    Returns:
        fastapi.FastAPI: Fully wired application instance.
    """
    settings = settings or get_settings()
    configure_logging(settings)

    application = FastAPI(
        title=settings.app_name,
        description=settings.app_description,
        version=settings.app_version,
        docs_url=settings.docs_url,
        redoc_url=settings.redoc_url,
        openapi_url=settings.openapi_url,
        lifespan=lifespan,
    )
    application.state.settings = settings

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=settings.cors_allow_credentials,
        allow_methods=settings.cors_allow_methods,
        allow_headers=settings.cors_allow_headers,
    )

    application.include_router(health.router)
    application.include_router(build_api_router())
    register_exception_handlers(application)
    mount_frontend(application, settings)

    return application


def mount_frontend(application: FastAPI, settings: Settings) -> None:
    """Serve the bundled web client from the configured mount path.

    Serving the client from the API process keeps deployment to a single
    command and removes cross-origin requests entirely.  The mount is skipped
    silently when disabled or when the directory is absent, so an API-only
    deployment needs no code change.

    Args:
        application: Application to mount the static files on.
        settings: Settings supplying the directory and the mount path.

    Returns:
        None
    """
    if not settings.serve_frontend:
        logger.info("Frontend serving is disabled (SERVE_FRONTEND=false)")
        return

    directory = settings.frontend_dir
    if not directory.is_dir() or not (directory / "index.html").is_file():
        logger.warning("Frontend directory %s has no index.html; skipping mount", directory)
        return

    application.mount(
        settings.frontend_mount_path,
        StaticFiles(directory=directory, html=True),
        name="frontend",
    )
    logger.info("Frontend mounted at %s from %s", settings.frontend_mount_path, directory)


#: ASGI application consumed by ``uvicorn app.main:app``.
app = create_app()


def main() -> None:
    """Run the development server from the command line.

    Returns:
        None
    """
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":  # pragma: no cover - manual entry point
    main()
