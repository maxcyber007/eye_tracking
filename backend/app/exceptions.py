"""Domain specific exception hierarchy.

Business modules raise these exceptions instead of ``HTTPException`` so the AI
layer stays framework agnostic.  ``app.main`` registers handlers that translate
each exception into the appropriate HTTP response.
"""

from __future__ import annotations

from typing import Any


class EyeTrackingError(Exception):
    """Base class for every error raised by this application.

    Attributes:
        message: Human readable description of the failure.
        status_code: HTTP status code the API layer should answer with.
        details: Optional structured payload attached to the error response.
    """

    status_code: int = 500

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        """Create a new domain error.

        Args:
            message: Human readable description of the failure.
            details: Optional structured payload attached to the error response.
        """
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        """Serialise the error into a JSON friendly mapping.

        Returns:
            dict[str, Any]: Payload with the error type, message and details.
        """
        return {
            "error": type(self).__name__,
            "message": self.message,
            "details": self.details,
        }


class ConfigurationError(EyeTrackingError):
    """Raised when the runtime configuration is inconsistent or unusable."""

    status_code = 500


class InvalidVideoError(EyeTrackingError):
    """Raised when an uploaded file is missing, empty, too large or unsupported."""

    status_code = 400


class VideoProcessingError(EyeTrackingError):
    """Raised when OpenCV cannot decode the video or no frame could be read."""

    status_code = 422


class NoFaceDetectedError(EyeTrackingError):
    """Raised when FaceMesh could not detect a face in enough frames."""

    status_code = 422


class FeatureExtractionError(EyeTrackingError):
    """Raised when the per-frame signals cannot be aggregated into features."""

    status_code = 422


class DatasetError(EyeTrackingError):
    """Raised when the training dataset is missing, malformed or too small."""

    status_code = 400


class ModelNotTrainedError(EyeTrackingError):
    """Raised when a prediction is requested before any model has been trained."""

    status_code = 409


class ModelTrainingError(EyeTrackingError):
    """Raised when the estimator cannot be fitted with the supplied dataset."""

    status_code = 422


class ModelRegistryError(EyeTrackingError):
    """Raised when an unknown model type is requested from the registry."""

    status_code = 400


class RepositoryError(EyeTrackingError):
    """Raised when a database operation fails."""

    status_code = 500
