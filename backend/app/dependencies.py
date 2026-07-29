"""FastAPI dependency providers.

Keeping the wiring in one module means the routers never construct their own
collaborators, so every dependency can be overridden in tests with
``app.dependency_overrides``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any, Sequence

from fastapi import Depends, Request, UploadFile

from app.ai import utils
from app.ai.feature_engineering import DatasetRepository
from app.ai.pipeline import EyeTrackingPipeline
from app.ai.predict_model import RiskPredictor, get_predictor
from app.ai.train_model import ModelTrainer
from app.auth import SessionRepository, User, UserRepository
from app.config import Settings, get_settings
from app.database import Database, TestHistoryRepository, get_database
from app.exceptions import InvalidVideoError, UnauthorizedError
from app.logging_config import get_logger

logger = get_logger(__name__)

#: Number of bytes streamed per chunk when persisting an upload.
UPLOAD_CHUNK_SIZE: int = 1024 * 1024


def provide_settings() -> Settings:
    """Provide the application settings.

    Returns:
        Settings: The cached settings singleton.
    """
    return get_settings()


SettingsDep = Annotated[Settings, Depends(provide_settings)]


def provide_database(settings: SettingsDep) -> Database:
    """Provide the shared database handle.

    Args:
        settings: Injected application settings.

    Returns:
        Database: Shared database handle.
    """
    return get_database(settings)


DatabaseDep = Annotated[Database, Depends(provide_database)]


def provide_history_repository(database: DatabaseDep) -> TestHistoryRepository:
    """Provide the ``test_history`` repository.

    Args:
        database: Injected database handle.

    Returns:
        TestHistoryRepository: Repository bound to the shared database.
    """
    return TestHistoryRepository(database)


HistoryRepositoryDep = Annotated[TestHistoryRepository, Depends(provide_history_repository)]


def provide_user_repository(database: DatabaseDep) -> UserRepository:
    """Provide the user account repository.

    Args:
        database: Injected database handle.

    Returns:
        UserRepository: Repository bound to the shared database.
    """
    return UserRepository(database)


UserRepositoryDep = Annotated[UserRepository, Depends(provide_user_repository)]


def provide_session_repository(database: DatabaseDep, settings: SettingsDep) -> SessionRepository:
    """Provide the session token repository.

    Args:
        database: Injected database handle.
        settings: Injected application settings.

    Returns:
        SessionRepository: Repository bound to the shared database.
    """
    return SessionRepository(database, settings)


SessionRepositoryDep = Annotated[SessionRepository, Depends(provide_session_repository)]


def read_session_token(request: Request, settings: Settings) -> str | None:
    """Extract the session token from the cookie or the Authorization header.

    The cookie is what the dashboard uses; the bearer header exists so scripts
    and integration tests can authenticate without a cookie jar.

    Args:
        request: Incoming request.
        settings: Application settings supplying the cookie name.

    Returns:
        str | None: The raw token, or ``None`` when the request carries none.
    """
    cookie = request.cookies.get(settings.session_cookie_name)
    if cookie:
        return cookie

    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return None


def provide_current_user(
    request: Request,
    settings: SettingsDep,
    sessions: SessionRepositoryDep,
) -> User:
    """Resolve the signed-in account, rejecting the request when absent.

    Args:
        request: Incoming request.
        settings: Injected application settings.
        sessions: Injected session repository.

    Returns:
        User: The signed-in account.  When ``auth_enabled`` is false a synthetic
        account is returned so the API stays usable in a trusted environment.

    Raises:
        UnauthorizedError: When no valid session accompanies the request.
    """
    if not settings.auth_enabled:
        return User(
            id=0,
            username="anonymous",
            display_name="Authentication disabled",
            role="admin",
            is_active=True,
            created_at=utils.utc_now_iso(),
        )

    user = sessions.resolve(read_session_token(request, settings) or "")
    if user is None:
        raise UnauthorizedError("กรุณาเข้าสู่ระบบก่อนใช้งานส่วนนี้")
    return user


CurrentUserDep = Annotated[User, Depends(provide_current_user)]


def provide_predictor(settings: SettingsDep) -> RiskPredictor:
    """Provide the shared risk predictor.

    Args:
        settings: Injected application settings.

    Returns:
        RiskPredictor: Shared predictor singleton.
    """
    return get_predictor(settings)


PredictorDep = Annotated[RiskPredictor, Depends(provide_predictor)]


def provide_dataset_repository(settings: SettingsDep) -> DatasetRepository:
    """Provide the dataset repository.

    Args:
        settings: Injected application settings.

    Returns:
        DatasetRepository: Repository pointing at the configured dataset.
    """
    return DatasetRepository(settings)


DatasetRepositoryDep = Annotated[DatasetRepository, Depends(provide_dataset_repository)]


def provide_trainer(settings: SettingsDep) -> ModelTrainer:
    """Provide a model trainer.

    Args:
        settings: Injected application settings.

    Returns:
        ModelTrainer: Trainer bound to the configured paths.
    """
    return ModelTrainer(settings)


TrainerDep = Annotated[ModelTrainer, Depends(provide_trainer)]


def provide_pipeline(settings: SettingsDep, predictor: PredictorDep) -> EyeTrackingPipeline:
    """Provide a request-scoped analysis pipeline.

    A fresh pipeline (and therefore a fresh FaceMesh graph) is created per
    request because MediaPipe graphs are stateful and not thread-safe.

    Args:
        settings: Injected application settings.
        predictor: Injected shared predictor.

    Returns:
        EyeTrackingPipeline: Pipeline ready to analyse one recording.
    """
    return EyeTrackingPipeline(settings, predictor=predictor)


PipelineDep = Annotated[EyeTrackingPipeline, Depends(provide_pipeline)]


# --------------------------------------------------------------------------- #
# Upload helpers                                                              #
# --------------------------------------------------------------------------- #
async def save_upload(upload: UploadFile, settings: Settings) -> Path:
    """Stream an uploaded video to the configured upload directory.

    The file is written in chunks so a large recording never has to be buffered
    entirely in memory, and it is deleted again if the size limit is exceeded.

    Args:
        upload: The multipart file received from the client.
        settings: Application settings supplying the directory and limits.

    Returns:
        Path: Absolute path of the stored file.

    Raises:
        InvalidVideoError: When the file is missing, empty, oversized or has an
            unsupported extension.
    """
    if upload is None or not upload.filename:
        raise InvalidVideoError("No video file was provided.")

    suffix = Path(upload.filename).suffix.lower()
    if suffix not in settings.allowed_video_extensions:
        raise InvalidVideoError(
            "Unsupported video extension '{}'.".format(suffix or "(none)"),
            details={"allowed": settings.allowed_video_extensions},
        )

    directory = utils.ensure_directory(settings.upload_dir)
    destination = directory / utils.build_unique_filename(upload.filename)

    written = 0
    try:
        with destination.open("wb") as handle:
            while chunk := await upload.read(UPLOAD_CHUNK_SIZE):
                written += len(chunk)
                if written > settings.max_upload_size_bytes:
                    raise InvalidVideoError(
                        f"Video exceeds the {settings.max_upload_size_mb:.0f} MB limit.",
                        details={"limit_bytes": settings.max_upload_size_bytes},
                    )
                handle.write(chunk)
    except InvalidVideoError:
        destination.unlink(missing_ok=True)
        raise
    except OSError as exc:
        destination.unlink(missing_ok=True)
        raise InvalidVideoError(f"The upload could not be stored: {exc}") from exc
    finally:
        await upload.close()

    if written == 0:
        destination.unlink(missing_ok=True)
        raise InvalidVideoError("The uploaded video is empty.")

    logger.info("Stored upload %s (%.2f MB)", destination.name, written / (1024 * 1024))
    return destination


def parse_target_trajectory(raw: str | None) -> Sequence[dict[str, float]] | None:
    """Parse the optional stimulus trajectory sent as a JSON form field.

    Accepts either ``[{"t":0,"x":0.1,"y":0.5}, ...]`` or an object with a
    ``points`` / ``trajectory`` key wrapping such a list.

    Args:
        raw: Raw JSON string from the multipart form, if any.

    Returns:
        Sequence[dict[str, float]] | None: Parsed points, or ``None`` when the
        field was absent or unusable.

    Raises:
        InvalidVideoError: When the field contains malformed JSON.
    """
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None

    try:
        payload: Any = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise InvalidVideoError(f"target_trajectory is not valid JSON: {exc}") from exc

    if isinstance(payload, dict):
        payload = payload.get("points") or payload.get("trajectory") or []
    if not isinstance(payload, list):
        logger.warning("target_trajectory is not a list; ignoring it.")
        return None

    points = [item for item in payload if isinstance(item, dict)]
    return points or None


def resolve_stored_video(filename: str, settings: Settings) -> Path:
    """Resolve a previously uploaded filename to a path inside the upload dir.

    Args:
        filename: Filename returned by ``POST /api/upload``.
        settings: Application settings supplying the upload directory.

    Returns:
        Path: Absolute path of the stored recording.

    Raises:
        InvalidVideoError: When the name escapes the upload directory or the
            file does not exist.
    """
    upload_dir = settings.upload_dir.resolve()
    candidate = (upload_dir / Path(filename).name).resolve()
    if upload_dir not in candidate.parents:
        raise InvalidVideoError("The requested filename is outside the upload directory.")
    if not candidate.is_file():
        raise InvalidVideoError(f"No stored recording named '{candidate.name}'.")
    return candidate
