"""Application configuration.

Every path, threshold and hyper-parameter used by the system is declared here and
can be overridden through environment variables or a ``.env`` file.  Nothing in
the code base is allowed to hardcode a filesystem path or a magic number: modules
must always read their values from :func:`get_settings`.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Directory that contains the ``app`` package (``backend/``).
BACKEND_ROOT: Path = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Strongly typed application settings.

    Attributes are populated (in order of precedence) from: explicit keyword
    arguments, environment variables, the ``.env`` file and finally the defaults
    declared below.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        protected_namespaces=(),
    )

    # ------------------------------------------------------------------ app --
    app_name: str = Field(default="Alzheimer Eye-Tracking Risk API")
    app_version: str = Field(default="0.1.0")
    app_description: str = Field(
        default=(
            "Research prototype that estimates an early Alzheimer's disease risk "
            "score from smartphone front-camera eye-tracking recordings."
        )
    )
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = True

    host: str = "0.0.0.0"
    port: int = 8000

    docs_url: str = "/docs"
    redoc_url: str = "/redoc"
    openapi_url: str = "/openapi.json"
    api_prefix: str = "/api"

    cors_allow_origins: list[str] = Field(default_factory=lambda: ["*"])
    cors_allow_credentials: bool = False
    cors_allow_methods: list[str] = Field(default_factory=lambda: ["*"])
    cors_allow_headers: list[str] = Field(default_factory=lambda: ["*"])

    # ---------------------------------------------------------------- paths --
    base_dir: Path = Field(default=BACKEND_ROOT)
    upload_dir: Path = Field(default=BACKEND_ROOT / "app" / "uploads")
    model_dir: Path = Field(default=BACKEND_ROOT / "app" / "models")
    dataset_dir: Path = Field(default=BACKEND_ROOT / "dataset")
    log_dir: Path = Field(default=BACKEND_ROOT / "logs")

    model_filename: str = "eye_model.pkl"
    dataset_filename: str = "dataset.csv"
    frame_csv_suffix: str = "_output.csv"

    database_url: str = Field(default=f"sqlite:///{BACKEND_ROOT / 'app' / 'eye_tracking.db'}")

    # -------------------------------------------------------------- logging --
    log_level: str = "INFO"
    log_format: str = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
    log_to_file: bool = False
    log_filename: str = "app.log"

    # ---------------------------------------------------------------- video --
    allowed_video_extensions: list[str] = Field(
        default_factory=lambda: [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"]
    )
    max_upload_size_mb: float = 200.0
    default_fps: float = 30.0
    max_frames: int = 3600
    frame_resize_width: int = 640

    # ----------------------------------------------------------- mediapipe --
    face_mesh_static_mode: bool = False
    face_mesh_max_faces: int = 1
    face_mesh_refine_landmarks: bool = True
    face_mesh_min_detection_confidence: float = 0.5
    face_mesh_min_tracking_confidence: float = 0.5

    # ------------------------------------------------- eye-movement thresholds
    blink_ear_threshold: float = 0.21
    blink_min_frames: int = 2
    saccade_velocity_threshold: float = 1.2
    fixation_velocity_threshold: float = 0.35
    fixation_min_frames: int = 3
    smoothing_window: int = 7
    smoothing_polyorder: int = 2
    min_valid_frame_ratio: float = 0.30

    # ------------------------------------------------------------ ml model --
    model_type: str = "random_forest"
    feature_columns: list[str] = Field(
        default_factory=lambda: [
            "eye_velocity",
            "eye_acceleration",
            "eye_distance",
            "movement_smoothness",
            "blink_rate",
            "fixation_time",
            "total_distance",
            "average_velocity",
            "max_velocity",
            "tracking_error",
        ]
    )
    label_column: str = "label"
    positive_class: int = 1
    test_size: float = 0.2
    random_state: int = 42
    cv_folds: int = 5
    model_params: dict[str, Any] = Field(
        default_factory=lambda: {
            "n_estimators": 300,
            "max_depth": None,
            "min_samples_split": 2,
            "min_samples_leaf": 1,
            "class_weight": "balanced",
            "n_jobs": -1,
        }
    )

    # ------------------------------------------------------- risk thresholds --
    risk_threshold_low: float = 0.34
    risk_threshold_moderate: float = 0.67
    risk_level_labels: list[str] = Field(default_factory=lambda: ["Low", "Moderate", "High"])

    # ------------------------------------------------------------ validators --
    @field_validator(
        "cors_allow_origins",
        "cors_allow_methods",
        "cors_allow_headers",
        "allowed_video_extensions",
        "feature_columns",
        "risk_level_labels",
        mode="before",
    )
    @classmethod
    def _split_list(cls, value: Any) -> Any:
        """Allow list settings to be supplied as JSON or comma separated strings."""
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                return json.loads(text)
            return [item.strip() for item in text.split(",") if item.strip()]
        return value

    @field_validator("model_params", mode="before")
    @classmethod
    def _parse_mapping(cls, value: Any) -> Any:
        """Allow dict settings to be supplied as a JSON string in the environment."""
        if isinstance(value, str):
            text = value.strip()
            return json.loads(text) if text else {}
        return value

    @field_validator("allowed_video_extensions")
    @classmethod
    def _normalise_extensions(cls, value: list[str]) -> list[str]:
        """Force every allowed extension to be lowercase and dot-prefixed."""
        return [ext if ext.startswith(".") else f".{ext}" for ext in (e.lower() for e in value)]

    @field_validator("log_level")
    @classmethod
    def _upper_log_level(cls, value: str) -> str:
        """Normalise the logging level to the uppercase form expected by ``logging``."""
        return value.upper()

    @model_validator(mode="after")
    def _check_risk_thresholds(self) -> "Settings":
        """Guarantee that the risk thresholds are ordered and inside ``[0, 1]``."""
        if not 0.0 < self.risk_threshold_low < self.risk_threshold_moderate < 1.0:
            raise ValueError(
                "risk thresholds must satisfy 0 < risk_threshold_low < "
                "risk_threshold_moderate < 1"
            )
        if len(self.risk_level_labels) != 3:
            raise ValueError("risk_level_labels must contain exactly three labels")
        return self

    # -------------------------------------------------------- derived paths --
    @property
    def model_path(self) -> Path:
        """Absolute path of the serialised model bundle."""
        return self.model_dir / self.model_filename

    @property
    def dataset_path(self) -> Path:
        """Absolute path of the aggregated training dataset."""
        return self.dataset_dir / self.dataset_filename

    @property
    def database_path(self) -> Path:
        """Filesystem path extracted from :attr:`database_url`."""
        url = self.database_url
        prefix = "sqlite:///"
        raw = url[len(prefix) :] if url.startswith(prefix) else url
        return Path(raw).expanduser().resolve()

    @property
    def max_upload_size_bytes(self) -> int:
        """Maximum accepted upload size expressed in bytes."""
        return int(self.max_upload_size_mb * 1024 * 1024)

    @property
    def managed_directories(self) -> tuple[Path, ...]:
        """Directories that must exist before the application can serve traffic."""
        directories = [self.upload_dir, self.model_dir, self.dataset_dir, self.database_path.parent]
        if self.log_to_file:
            directories.append(self.log_dir)
        return tuple(directories)

    def ensure_directories(self) -> None:
        """Create every managed directory, ignoring the ones that already exist."""
        for directory in self.managed_directories:
            directory.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide cached :class:`Settings` instance.

    Returns:
        Settings: Singleton settings object shared by every module and FastAPI
        dependency.
    """
    return Settings()


def reload_settings() -> Settings:
    """Clear the settings cache and rebuild it (useful in tests).

    Returns:
        Settings: A freshly constructed settings object.
    """
    get_settings.cache_clear()
    return get_settings()
