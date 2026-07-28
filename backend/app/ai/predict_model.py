"""Inference service.

Holds a thread-safe, hot-reloadable cache around the serialised model bundle and
turns an aggregated feature vector into a risk score, a confidence and a risk
level label.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from app.ai import utils
from app.ai.base import BaseRiskModel
from app.ai.feature_engineering import FeatureVector
from app.config import Settings, get_settings
from app.exceptions import ModelNotTrainedError
from app.logging_config import get_logger

# Importing the estimators module populates the model registry before loading.
from app.ai import estimators as _estimators  # noqa: F401

logger = get_logger(__name__)


@dataclass(slots=True)
class PredictionResult:
    """Outcome of a single risk prediction.

    Attributes:
        risk_score: Continuous risk in ``[0, 1]``.
        risk_level: Discrete band label (``Low`` / ``Moderate`` / ``High``).
        confidence: Probability of the predicted class, in ``[0, 1]``.
        model_type: Registry key of the model that produced the prediction.
        features: Aggregated features fed to the model.
        metadata: Descriptive information about the analysed recording.
    """

    risk_score: float
    risk_level: str
    confidence: float
    model_type: str
    features: dict[str, float] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialise the prediction into a JSON friendly mapping.

        Returns:
            dict[str, Any]: Plain mapping suitable for API responses.
        """
        return {
            "risk_score": round(self.risk_score, 4),
            "risk_level": self.risk_level,
            "confidence": round(self.confidence, 4),
            "model_type": self.model_type,
            "features": {key: round(float(value), 6) for key, value in self.features.items()},
            "metadata": dict(self.metadata),
        }


class RiskPredictor:
    """Cached, thread-safe access to the trained risk model.

    The bundle is loaded once and reused across requests; the file's modification
    time is checked on every access so a freshly trained model is picked up
    without restarting the server.

    Attributes:
        settings: Application settings supplying the model path and thresholds.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        """Create a predictor bound to a settings object.

        Args:
            settings: Settings instance; the cached global settings are used when
                omitted.
        """
        self.settings: Settings = settings or get_settings()
        self._model: BaseRiskModel | None = None
        self._loaded_mtime: float | None = None
        self._lock = threading.RLock()

    # ------------------------------------------------------------- lifecycle --
    @property
    def model_path(self) -> Path:
        """Path of the serialised model bundle."""
        return self.settings.model_path

    @property
    def is_ready(self) -> bool:
        """Whether a trained artefact exists on disk."""
        return self.model_path.exists()

    def load(self, *, force: bool = False) -> BaseRiskModel:
        """Return the cached model, reloading it when the artefact changed.

        Args:
            force: Reload from disk even when the cache looks fresh.

        Returns:
            BaseRiskModel: The fitted model.

        Raises:
            ModelNotTrainedError: When no artefact exists or it cannot be read.
        """
        path = self.model_path
        if not path.exists():
            raise ModelNotTrainedError(
                "No trained model is available. Call POST /api/train first.",
                details={"model_path": str(path)},
            )

        with self._lock:
            mtime = path.stat().st_mtime
            if force or self._model is None or self._loaded_mtime != mtime:
                logger.info("Loading model bundle from %s", path)
                try:
                    self._model = BaseRiskModel.load(path)
                except ModelNotTrainedError:
                    raise
                except Exception as exc:
                    raise ModelNotTrainedError(
                        f"The model artefact could not be loaded: {exc}",
                        details={"model_path": str(path)},
                    ) from exc
                self._loaded_mtime = mtime
            return self._model

    def invalidate(self) -> None:
        """Drop the cached model so the next call reloads it from disk.

        Returns:
            None
        """
        with self._lock:
            self._model = None
            self._loaded_mtime = None

    def info(self) -> dict[str, Any]:
        """Describe the currently available model without raising.

        Returns:
            dict[str, Any]: Availability flag, path, type, metrics and metadata.
        """
        if not self.is_ready:
            return {"available": False, "model_path": str(self.model_path)}
        try:
            model = self.load()
        except ModelNotTrainedError as exc:
            return {"available": False, "model_path": str(self.model_path), "error": exc.message}
        return {
            "available": True,
            "model_path": str(self.model_path),
            "model_type": model.model_type,
            "feature_columns": list(model.feature_columns),
            "classes": model.classes,
            "metrics": dict(model.metrics),
            "metadata": dict(model.metadata),
        }

    # ------------------------------------------------------------ inference --
    def predict(
        self,
        features: Mapping[str, float] | FeatureVector,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> PredictionResult:
        """Score an aggregated feature vector.

        Args:
            features: Feature mapping or a :class:`FeatureVector`.
            metadata: Extra descriptive information merged into the result.

        Returns:
            PredictionResult: Risk score, level, confidence and echoed features.

        Raises:
            ModelNotTrainedError: When no trained artefact is available.
        """
        settings = self.settings
        if isinstance(features, FeatureVector):
            feature_map = dict(features.features)
            merged_metadata: dict[str, Any] = {**features.metadata, **(metadata or {})}
        else:
            feature_map = {key: utils.to_float(value, 0.0) for key, value in features.items()}
            merged_metadata = dict(metadata or {})

        model = self.load()
        score, confidence = model.risk_score(feature_map)
        level = utils.classify_risk_level(
            score,
            settings.risk_threshold_low,
            settings.risk_threshold_moderate,
            settings.risk_level_labels,
        )

        logger.info(
            "Prediction: score=%.4f level=%s confidence=%.4f model=%s",
            score,
            level,
            confidence,
            model.model_type,
        )
        return PredictionResult(
            risk_score=score,
            risk_level=level,
            confidence=confidence,
            model_type=model.model_type,
            features=feature_map,
            metadata=merged_metadata,
        )


#: Process-wide predictor reused by the FastAPI dependency layer.
_PREDICTOR: RiskPredictor | None = None
_PREDICTOR_LOCK = threading.Lock()


def get_predictor(settings: Settings | None = None) -> RiskPredictor:
    """Return the process-wide :class:`RiskPredictor` singleton.

    Args:
        settings: Optional settings override used on first construction.

    Returns:
        RiskPredictor: Shared predictor instance.
    """
    global _PREDICTOR
    if _PREDICTOR is None:
        with _PREDICTOR_LOCK:
            if _PREDICTOR is None:
                _PREDICTOR = RiskPredictor(settings=settings)
    return _PREDICTOR


def reset_predictor() -> None:
    """Discard the predictor singleton (used by tests and after retraining).

    Returns:
        None
    """
    global _PREDICTOR
    with _PREDICTOR_LOCK:
        _PREDICTOR = None
