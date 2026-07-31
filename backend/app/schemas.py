"""Pydantic request/response models.

These schemas are the public contract of the API and drive the OpenAPI document
served at ``/docs``.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

# The floor is a property of the train/test split (both classes must survive it),
# not a preference, so it is owned by the module that generates the samples and
# imported here rather than repeated as a literal.
from app.ai.synthetic import MIN_SAMPLES as MIN_SYNTHETIC_SAMPLES

#: Accepted participant age range, in years. Wide enough not to reject a real
#: participant, narrow enough to catch a mistyped year of birth.
MIN_AGE = 1
MAX_AGE = 120


# --------------------------------------------------------------------------- #
# Shared building blocks                                                      #
# --------------------------------------------------------------------------- #
class TargetPoint(BaseModel):
    """One sample of the on-screen stimulus trajectory.

    Attributes:
        t: Time of the sample in seconds (milliseconds are auto-detected).
        x: Horizontal stimulus position, any consistent unit.
        y: Vertical stimulus position, any consistent unit.
    """

    model_config = ConfigDict(extra="ignore")

    t: float = Field(description="Time of the sample in seconds since recording start.")
    x: float = Field(description="Horizontal stimulus position.")
    y: float = Field(description="Vertical stimulus position.")


class VideoInfo(BaseModel):
    """Technical description of an analysed recording."""

    filename: str = Field(description="Stored filename of the recording.")
    width: int = Field(description="Frame width in pixels after resizing.")
    height: int = Field(description="Frame height in pixels after resizing.")
    fps: float = Field(description="Effective frame rate used for the timestamps.")
    frame_count: int = Field(description="Number of frames processed.")
    duration: float = Field(description="Processed duration in seconds.")
    detected_frames: int = Field(description="Frames in which a face was detected.")
    detection_ratio: float = Field(description="Share of frames with a detected face.")


class EyeFeatures(BaseModel):
    """The ten aggregated eye-tracking features consumed by the model."""

    eye_velocity: float = Field(description="Mean gaze speed in eye-units per second.")
    eye_acceleration: float = Field(description="Mean absolute gaze acceleration.")
    eye_distance: float = Field(description="Mean inter-ocular distance, normalised by frame width.")
    movement_smoothness: float = Field(
        description="Log dimensionless jerk; higher values mean smoother pursuit."
    )
    blink_rate: float = Field(description="Detected blinks per minute.")
    fixation_time: float = Field(description="Total time spent in fixation, in seconds.")
    total_distance: float = Field(description="Cumulative gaze path length in eye-units.")
    average_velocity: float = Field(description="Path length divided by the recording duration.")
    max_velocity: float = Field(description="Peak gaze speed in eye-units per second.")
    tracking_error: float = Field(
        description="RMS deviation from the stimulus path, or gaze instability when no path is given."
    )


class SampleMetadata(BaseModel):
    """Descriptive, non-predictive information about an analysed sample."""

    model_config = ConfigDict(extra="allow")

    sample_id: str = Field(default="", description="Unique identifier of the sample.")
    created_at: str = Field(default="", description="ISO-8601 UTC analysis timestamp.")
    filename: str = Field(default="", description="Stored filename of the recording.")
    subject_id: str = Field(default="", description="Optional participant identifier.")
    duration: float = Field(default=0.0, description="Processed duration in seconds.")
    frame_count: int = Field(default=0, description="Number of frames processed.")
    fps: float = Field(default=0.0, description="Effective frame rate.")
    detection_ratio: float = Field(default=0.0, description="Share of frames with a face.")
    blink_count: int = Field(default=0, description="Number of detected blinks.")
    saccade_count: int = Field(default=0, description="Number of detected saccades.")
    fixation_ratio: float = Field(default=0.0, description="Share of the recording in fixation.")
    saccade_ratio: float = Field(default=0.0, description="Share of frames flagged as saccadic.")
    velocity_std: float = Field(default=0.0, description="Standard deviation of the gaze speed.")
    tracking_error_source: str = Field(
        default="self",
        description="'target' when a stimulus path was supplied, otherwise 'self'.",
    )


class PredictionPayload(BaseModel):
    """Risk prediction returned by the model."""

    risk_score: float = Field(ge=0.0, le=1.0, description="Continuous risk score in [0, 1].")
    risk_level: str = Field(description="Risk band: Low, Moderate or High.")
    confidence: float = Field(ge=0.0, le=1.0, description="Probability of the predicted class.")
    model_type: str = Field(description="Registry key of the model used.")
    history_id: int | None = Field(
        default=None, description="Primary key of the stored history record, when saved."
    )
    features: dict[str, float] = Field(
        default_factory=dict, description="Features fed to the model."
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Descriptive sample information."
    )


# --------------------------------------------------------------------------- #
# Health                                                                      #
# --------------------------------------------------------------------------- #
class RootResponse(BaseModel):
    """Payload of the ``GET /`` health check."""

    status: str = Field(description="Always 'ok' when the service is up.")
    app: str = Field(description="Application name.")
    version: str = Field(description="Application version.")
    environment: str = Field(description="Deployment environment.")
    docs_url: str = Field(description="Relative URL of the Swagger UI.")
    ui_url: str | None = Field(
        default=None, description="Relative URL of the bundled web client, when served."
    )


class HealthResponse(BaseModel):
    """Payload of the ``GET /health`` readiness probe."""

    status: str = Field(description="'ok' when every dependency is reachable.")
    app: str = Field(description="Application name.")
    version: str = Field(description="Application version.")
    environment: str = Field(description="Deployment environment.")
    database: bool = Field(description="Whether SQLite responded to a probe query.")
    model_available: bool = Field(description="Whether a trained model artefact exists.")
    model_type: str | None = Field(default=None, description="Type of the loaded model.")
    dataset: dict[str, Any] = Field(
        default_factory=dict, description="Row and per-class counts of the dataset."
    )
    available_models: list[str] = Field(
        default_factory=list, description="Model implementations registered at runtime."
    )
    history_count: int = Field(default=0, description="Number of stored assessments.")


# --------------------------------------------------------------------------- #
# Upload                                                                      #
# --------------------------------------------------------------------------- #
class UploadResponse(BaseModel):
    """Payload returned by ``POST /api/upload``."""

    success: bool = Field(default=True, description="Whether the recording was processed.")
    message: str = Field(description="Human readable summary of the outcome.")
    filename: str = Field(description="Stored filename of the uploaded recording.")
    stored_path: str = Field(description="Absolute path of the stored recording.")
    frame_csv_path: str | None = Field(
        default=None, description="Absolute path of the per-frame CSV."
    )
    dataset_path: str | None = Field(
        default=None, description="Dataset the labelled sample was appended to."
    )
    video_deleted: bool = Field(
        default=False,
        description=(
            "Whether the recording was deleted after its features joined the dataset. "
            "The per-frame CSV is kept either way."
        ),
    )
    video: VideoInfo = Field(description="Technical description of the recording.")
    blink_count: int = Field(description="Number of detected blinks.")
    saccade_count: int = Field(description="Number of detected saccades.")
    features: EyeFeatures = Field(description="Aggregated eye-tracking features.")
    sample_metadata: SampleMetadata = Field(description="Descriptive sample information.")
    prediction: PredictionPayload | None = Field(
        default=None, description="Prediction, when a trained model was available."
    )


# --------------------------------------------------------------------------- #
# Train                                                                       #
# --------------------------------------------------------------------------- #
class TrainRequest(BaseModel):
    """Body of ``POST /api/train``; every field is optional."""

    model_config = ConfigDict(protected_namespaces=(), extra="forbid")

    model_type: str | None = Field(
        default=None,
        description="Model implementation to train, e.g. 'random_forest'.",
    )
    dataset_path: str | None = Field(
        default=None, description="Override the dataset CSV used for training."
    )
    model_path: str | None = Field(
        default=None, description="Override the destination of the serialised model."
    )
    params: dict[str, Any] = Field(
        default_factory=dict,
        description="Hyper-parameters merged over the configured defaults.",
    )

    @field_validator("model_type", "dataset_path", "model_path")
    @classmethod
    def _blank_to_none(cls, value: str | None) -> str | None:
        """Treat empty strings coming from form clients as omitted values.

        Args:
            value: Raw field value.

        Returns:
            str | None: The trimmed value, or ``None`` when blank.
        """
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None


class TrainingMetricsPayload(BaseModel):
    """Evaluation metrics of a training run."""

    accuracy: float = Field(description="Hold-out accuracy.")
    precision: float = Field(description="Weighted hold-out precision.")
    recall: float = Field(description="Weighted hold-out recall.")
    f1_score: float = Field(description="Weighted hold-out F1 score.")
    roc_auc: float | None = Field(default=None, description="ROC AUC when computable.")
    cv_mean_accuracy: float | None = Field(
        default=None, description="Mean stratified cross-validation accuracy."
    )
    train_samples: int = Field(description="Number of training rows.")
    test_samples: int = Field(description="Number of hold-out rows.")
    class_distribution: dict[str, int] = Field(
        default_factory=dict, description="Row count per class."
    )
    confusion_matrix: list[list[int]] = Field(
        default_factory=list, description="Hold-out confusion matrix."
    )
    feature_importance: dict[str, float] = Field(
        default_factory=dict, description="Per-feature importance weights."
    )


class TrainResponse(BaseModel):
    """Payload returned by ``POST /api/train``."""

    model_config = ConfigDict(protected_namespaces=())

    success: bool = Field(default=True, description="Whether training succeeded.")
    message: str = Field(description="Human readable summary of the run.")
    model_type: str = Field(description="Model implementation that was trained.")
    model_path: str = Field(description="Where the serialised model was written.")
    dataset_path: str = Field(description="Dataset that was used.")
    feature_columns: list[str] = Field(description="Ordered features the model was fitted on.")
    metrics: TrainingMetricsPayload = Field(description="Hold-out evaluation metrics.")
    trained_at: str = Field(description="ISO-8601 UTC timestamp of the run.")


# --------------------------------------------------------------------------- #
# Predict                                                                     #
# --------------------------------------------------------------------------- #
class PredictFeaturesRequest(BaseModel):
    """Body accepted by ``POST /api/predict/features``."""

    features: dict[str, float] = Field(
        description="Mapping of feature name to value; missing features default to 0."
    )
    subject_id: str | None = Field(default=None, description="Optional participant identifier.")
    age: int | None = Field(
        default=None,
        ge=MIN_AGE,
        le=MAX_AGE,
        description="Participant age in years. Stored with the record, not used for scoring.",
    )
    filename: str | None = Field(
        default=None, description="Optional label stored with the history record."
    )
    save_history: bool = Field(
        default=True, description="Whether to persist the result in test_history."
    )


class PredictResponse(BaseModel):
    """Payload returned by the prediction endpoints."""

    success: bool = Field(default=True, description="Whether the prediction succeeded.")
    risk_score: float = Field(ge=0.0, le=1.0, description="Continuous risk score in [0, 1].")
    risk_level: str = Field(description="Risk band: Low, Moderate or High.")
    confidence: float = Field(ge=0.0, le=1.0, description="Probability of the predicted class.")
    model_type: str = Field(description="Registry key of the model used.")
    history_id: int | None = Field(
        default=None, description="Primary key of the stored history record."
    )
    filename: str | None = Field(default=None, description="Analysed recording, when applicable.")
    frame_csv_path: str | None = Field(
        default=None, description="Absolute path of the per-frame CSV."
    )
    video: VideoInfo | None = Field(default=None, description="Technical video description.")
    features: dict[str, float] = Field(
        default_factory=dict, description="Features fed to the model."
    )
    sample_metadata: dict[str, Any] = Field(
        default_factory=dict, description="Descriptive sample information."
    )


# --------------------------------------------------------------------------- #
# History                                                                     #
# --------------------------------------------------------------------------- #
class HistoryItem(BaseModel):
    """One stored assessment."""

    id: int = Field(description="Primary key of the record.")
    created_at: str = Field(description="ISO-8601 UTC creation timestamp.")
    filename: str = Field(description="Analysed recording.")
    risk_score: float = Field(description="Continuous risk score in [0, 1].")
    risk_level: str = Field(description="Risk band.")
    confidence: float = Field(description="Probability of the predicted class.")
    model_type: str | None = Field(default=None, description="Model used for the prediction.")
    subject_id: str | None = Field(default=None, description="Participant identifier.")
    age: int | None = Field(
        default=None,
        description="Participant age in years; null for assessments recorded before this field.",
    )
    features: dict[str, float] = Field(default_factory=dict, description="Stored features.")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Stored metadata.")


class HistoryDeleteResponse(BaseModel):
    """Result of removing one or more stored assessments."""

    success: bool = Field(default=True, description="Whether the deletion succeeded.")
    deleted: int = Field(description="Number of records removed by this request.")
    remaining: int = Field(description="Number of records still stored afterwards.")
    message: str = Field(description="Human readable summary of the outcome.")


class HistoryListResponse(BaseModel):
    """Paginated listing of stored assessments."""

    total: int = Field(description="Number of assessments matching the filter.")
    limit: int = Field(description="Page size that was applied.")
    offset: int = Field(description="Offset that was applied.")
    items: list[HistoryItem] = Field(default_factory=list, description="Matching records.")
    age_min_available: int | None = Field(
        default=None,
        description="Youngest age in the whole log, ignoring the filter. Null when none recorded.",
    )
    age_max_available: int | None = Field(
        default=None,
        description="Oldest age in the whole log, ignoring the filter. Null when none recorded.",
    )


# --------------------------------------------------------------------------- #
# Dataset and model maintenance                                               #
# --------------------------------------------------------------------------- #
class MockDatasetRequest(BaseModel):
    """Parameters of a synthetic dataset generation run."""

    samples: int = Field(
        default=200,
        ge=MIN_SYNTHETIC_SAMPLES,
        le=5000,
        description="Number of fabricated rows to generate.",
    )
    positive_ratio: float = Field(
        default=0.5,
        gt=0.0,
        lt=1.0,
        description="Share of rows labelled as at-risk (class 1).",
    )
    seed: int | None = Field(
        default=None,
        description="Random seed; omit to draw from entropy so repeated runs differ.",
    )
    append: bool = Field(
        default=False,
        description="Append to the existing dataset instead of replacing it.",
    )


class MockDatasetResponse(BaseModel):
    """Result of generating a synthetic dataset."""

    success: bool = Field(default=True, description="Whether the generation succeeded.")
    generated: int = Field(description="Number of rows generated by this request.")
    appended: bool = Field(description="Whether the rows were appended rather than replacing.")
    dataset_path: str = Field(description="Absolute path of the dataset that was written.")
    dataset: dict[str, Any] = Field(description="Dataset summary after the write.")
    message: str = Field(description="Human readable summary of the outcome.")


class DatasetDeleteResponse(BaseModel):
    """Result of deleting the aggregated dataset."""

    success: bool = Field(default=True, description="Whether the deletion succeeded.")
    deleted: int = Field(description="Number of rows that were discarded.")
    dataset_path: str = Field(description="Absolute path of the dataset that was removed.")
    message: str = Field(description="Human readable summary of the outcome.")


class ModelDeleteResponse(BaseModel):
    """Result of deleting the trained model artefact."""

    success: bool = Field(default=True, description="Whether the deletion succeeded.")
    deleted: bool = Field(description="Whether an artefact was actually removed.")
    model_path: str = Field(description="Absolute path of the artefact that was removed.")
    message: str = Field(description="Human readable summary of the outcome.")


# --------------------------------------------------------------------------- #
# Authentication                                                              #
# --------------------------------------------------------------------------- #
class LoginRequest(BaseModel):
    """Credentials submitted by the dashboard login form."""

    username: str = Field(min_length=1, max_length=64, description="Login name.")
    password: str = Field(min_length=1, max_length=256, description="Plain text password.")


class UserPayload(BaseModel):
    """Safe representation of an account; never carries a password."""

    id: int = Field(description="Primary key of the account.")
    username: str = Field(description="Login name.")
    display_name: str = Field(description="Human readable name.")
    role: str = Field(description="Coarse role label.")
    created_at: str = Field(description="ISO-8601 UTC creation timestamp.")
    last_login_at: str | None = Field(default=None, description="Last successful sign-in.")


class LoginResponse(BaseModel):
    """Result of a successful sign-in."""

    success: bool = Field(default=True, description="Always true on success.")
    message: str = Field(description="Human readable greeting.")
    user: UserPayload = Field(description="The signed-in account.")
    expires_at: str = Field(description="ISO-8601 UTC expiry of the new session.")


class LogoutResponse(BaseModel):
    """Result of ending a session."""

    success: bool = Field(default=True, description="Always true.")
    message: str = Field(description="Human readable confirmation.")


# --------------------------------------------------------------------------- #
# Errors                                                                      #
# --------------------------------------------------------------------------- #
class ErrorResponse(BaseModel):
    """Uniform error envelope returned by every failing endpoint."""

    success: bool = Field(default=False, description="Always false for errors.")
    error: str = Field(description="Exception class name.")
    message: str = Field(description="Human readable description of the failure.")
    details: dict[str, Any] = Field(default_factory=dict, description="Structured context.")
