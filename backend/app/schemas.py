"""Pydantic request/response models.

These schemas are the public contract of the API and drive the OpenAPI document
served at ``/docs``.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


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

    total: int = Field(description="Total number of stored assessments.")
    limit: int = Field(description="Page size that was applied.")
    offset: int = Field(description="Offset that was applied.")
    items: list[HistoryItem] = Field(default_factory=list, description="Matching records.")


# --------------------------------------------------------------------------- #
# Errors                                                                      #
# --------------------------------------------------------------------------- #
class ErrorResponse(BaseModel):
    """Uniform error envelope returned by every failing endpoint."""

    success: bool = Field(default=False, description="Always false for errors.")
    error: str = Field(description="Exception class name.")
    message: str = Field(description="Human readable description of the failure.")
    details: dict[str, Any] = Field(default_factory=dict, description="Structured context.")
