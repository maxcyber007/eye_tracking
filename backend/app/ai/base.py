"""Model abstraction layer and registry.

The rest of the application only ever talks to :class:`BaseRiskModel`.  Swapping
RandomForest for an LSTM or a PyTorch network therefore means: implement the
interface, decorate the class with :func:`register_model`, and change
``MODEL_TYPE`` in the environment.  No API or service code needs to change.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, ClassVar, Mapping, Sequence, TypeVar

import numpy as np
import pandas as pd

from app.ai import utils
from app.exceptions import ModelRegistryError
from app.logging_config import get_logger

logger = get_logger(__name__)

#: Registry mapping a model type name to its implementation class.
MODEL_REGISTRY: dict[str, type["BaseRiskModel"]] = {}

TModel = TypeVar("TModel", bound="BaseRiskModel")


def register_model(cls: type[TModel]) -> type[TModel]:
    """Class decorator that adds an implementation to :data:`MODEL_REGISTRY`.

    Args:
        cls: Concrete :class:`BaseRiskModel` subclass exposing a ``model_type``.

    Returns:
        type[BaseRiskModel]: The same class, unchanged.

    Raises:
        ModelRegistryError: When the class does not declare a ``model_type``.
    """
    model_type = getattr(cls, "model_type", "")
    if not model_type:
        raise ModelRegistryError(f"{cls.__name__} must declare a non-empty 'model_type'.")
    MODEL_REGISTRY[model_type] = cls
    logger.debug("Registered model implementation '%s' -> %s", model_type, cls.__name__)
    return cls


def available_models() -> list[str]:
    """List the model types currently registered.

    Returns:
        list[str]: Sorted registry keys.
    """
    return sorted(MODEL_REGISTRY)


def create_model(
    model_type: str,
    feature_columns: Sequence[str],
    params: Mapping[str, Any] | None = None,
) -> "BaseRiskModel":
    """Instantiate a registered model implementation.

    Args:
        model_type: Registry key, e.g. ``"random_forest"``.
        feature_columns: Ordered feature names the model consumes.
        params: Hyper-parameters forwarded to the implementation.

    Returns:
        BaseRiskModel: A fresh, untrained model instance.

    Raises:
        ModelRegistryError: When ``model_type`` is unknown.
    """
    try:
        implementation = MODEL_REGISTRY[model_type]
    except KeyError as exc:
        raise ModelRegistryError(
            f"Unknown model type '{model_type}'.",
            details={"available": available_models()},
        ) from exc
    return implementation(feature_columns=list(feature_columns), params=dict(params or {}))


@dataclass(slots=True)
class TrainingMetrics:
    """Evaluation metrics collected during training.

    Attributes:
        accuracy: Hold-out accuracy.
        precision: Weighted precision.
        recall: Weighted recall.
        f1_score: Weighted F1 score.
        roc_auc: ROC AUC when computable, otherwise ``None``.
        cv_mean_accuracy: Mean cross-validated accuracy when computable.
        train_samples: Number of training rows.
        test_samples: Number of hold-out rows.
        class_distribution: Row count per class in the full dataset.
        confusion_matrix: Hold-out confusion matrix as nested lists.
        feature_importance: Feature name to importance weight.
    """

    accuracy: float = 0.0
    precision: float = 0.0
    recall: float = 0.0
    f1_score: float = 0.0
    roc_auc: float | None = None
    cv_mean_accuracy: float | None = None
    train_samples: int = 0
    test_samples: int = 0
    class_distribution: dict[str, int] = field(default_factory=dict)
    confusion_matrix: list[list[int]] = field(default_factory=list)
    feature_importance: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialise the metrics into a JSON friendly mapping.

        Returns:
            dict[str, Any]: Plain mapping suitable for API responses.
        """
        return {
            "accuracy": round(self.accuracy, 6),
            "precision": round(self.precision, 6),
            "recall": round(self.recall, 6),
            "f1_score": round(self.f1_score, 6),
            "roc_auc": None if self.roc_auc is None else round(self.roc_auc, 6),
            "cv_mean_accuracy": (
                None if self.cv_mean_accuracy is None else round(self.cv_mean_accuracy, 6)
            ),
            "train_samples": self.train_samples,
            "test_samples": self.test_samples,
            "class_distribution": dict(self.class_distribution),
            "confusion_matrix": [list(map(int, row)) for row in self.confusion_matrix],
            "feature_importance": {
                key: round(float(value), 6) for key, value in self.feature_importance.items()
            },
        }


@dataclass(slots=True)
class ModelBundle:
    """Everything required to reload a trained model.

    Storing the feature order and the class list next to the estimator makes the
    artefact self-describing, so a prediction can never silently use the wrong
    column ordering.

    Attributes:
        model_type: Registry key of the implementation that produced the bundle.
        estimator: The fitted, framework-specific estimator object.
        feature_columns: Ordered feature names the estimator was fitted on.
        classes: Class labels in the estimator's own ordering.
        params: Hyper-parameters used at fit time.
        metrics: Training metrics as a plain mapping.
        metadata: Free-form provenance information.
    """

    model_type: str
    estimator: Any
    feature_columns: list[str]
    classes: list[int]
    params: dict[str, Any] = field(default_factory=dict)
    metrics: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseRiskModel(ABC):
    """Abstract risk estimator working on aggregated eye-tracking features.

    Attributes:
        model_type: Registry key implemented by the concrete subclass.
        feature_columns: Ordered feature names the model consumes.
        params: Hyper-parameters passed to the underlying estimator.
        metrics: Metrics recorded by the last :meth:`fit` call.
        metadata: Free-form provenance information persisted with the model.
    """

    model_type: ClassVar[str] = ""

    def __init__(
        self,
        feature_columns: Sequence[str],
        params: Mapping[str, Any] | None = None,
    ) -> None:
        """Create an untrained model.

        Args:
            feature_columns: Ordered feature names the model consumes.
            params: Hyper-parameters forwarded to the underlying estimator.
        """
        self.feature_columns: list[str] = list(feature_columns)
        self.params: dict[str, Any] = dict(params or {})
        self.metrics: dict[str, Any] = {}
        self.metadata: dict[str, Any] = {}
        self._estimator: Any | None = None
        self._classes: list[int] = []

    # ---------------------------------------------------------------- state --
    @property
    def is_fitted(self) -> bool:
        """Whether the model currently holds a fitted estimator."""
        return self._estimator is not None

    @property
    def classes(self) -> list[int]:
        """Class labels in the estimator's own ordering."""
        return list(self._classes)

    # -------------------------------------------------------------- contract --
    @abstractmethod
    def build_estimator(self) -> Any:
        """Instantiate the untrained, framework-specific estimator.

        Returns:
            Any: A fresh estimator object.
        """

    @abstractmethod
    def fit(self, features: pd.DataFrame, labels: np.ndarray) -> TrainingMetrics:
        """Fit the model and return its evaluation metrics.

        Args:
            features: Training features, one row per sample.
            labels: Supervised targets aligned with ``features``.

        Returns:
            TrainingMetrics: Metrics computed on the hold-out split.
        """

    @abstractmethod
    def predict_proba(self, features: pd.DataFrame) -> np.ndarray:
        """Return per-class probabilities for each input row.

        Args:
            features: Feature rows to score.

        Returns:
            numpy.ndarray: ``(n_samples, n_classes)`` probability matrix.
        """

    def feature_importance(self) -> dict[str, float]:
        """Return per-feature importance weights when the estimator exposes them.

        Returns:
            dict[str, float]: Feature name to importance; empty when unsupported.
        """
        estimator = self._estimator
        importances = getattr(estimator, "feature_importances_", None)
        if importances is None:
            return {}
        values = np.asarray(importances, dtype=float).ravel()
        return {
            name: float(value)
            for name, value in zip(self.feature_columns, values)
        }

    # ------------------------------------------------------------- inference --
    def align_features(self, features: pd.DataFrame | Mapping[str, float]) -> pd.DataFrame:
        """Reorder/complete an input so it matches the trained column layout.

        Args:
            features: Feature mapping or DataFrame, possibly with missing or
                extra columns.

        Returns:
            pandas.DataFrame: Frame containing exactly :attr:`feature_columns`,
            in order, with missing values filled with ``0.0``.
        """
        frame = pd.DataFrame([dict(features)]) if isinstance(features, Mapping) else features.copy()
        for column in self.feature_columns:
            if column not in frame.columns:
                logger.warning("Feature '%s' missing from the input; defaulting to 0.0", column)
                frame[column] = 0.0
        aligned = frame[self.feature_columns].astype(float)
        return aligned.replace([np.inf, -np.inf], 0.0).fillna(0.0)

    def risk_score(self, features: pd.DataFrame | Mapping[str, float]) -> tuple[float, float]:
        """Compute the continuous risk score and the prediction confidence.

        For binary problems the score is ``P(class = max class)``.  For ordinal
        multi-class problems it is the class-probability weighted mean, rescaled
        onto ``[0, 1]``, which keeps the endpoint contract stable if the label
        scheme is later extended.

        Args:
            features: Feature mapping or single-row DataFrame.

        Returns:
            tuple[float, float]: ``(risk_score, confidence)``, both in ``[0, 1]``.
        """
        probabilities = self.predict_proba(self.align_features(features))
        row = np.asarray(probabilities, dtype=float)[0]
        classes = np.asarray(self._classes, dtype=float)

        if classes.size == 0:
            return 0.0, 0.0
        if classes.size == 1:
            return (utils.clamp(float(classes[0] > 0)), 1.0)

        span = float(classes.max() - classes.min())
        normalised = (classes - classes.min()) / (span if span > 1e-9 else 1.0)
        score = float(np.dot(row, normalised))
        confidence = float(np.max(row))
        return utils.clamp(score), utils.clamp(confidence)

    # ---------------------------------------------------------- persistence --
    def to_bundle(self) -> ModelBundle:
        """Package the fitted model into a serialisable bundle.

        Returns:
            ModelBundle: Self-describing artefact ready to be persisted.
        """
        return ModelBundle(
            model_type=self.model_type,
            estimator=self._estimator,
            feature_columns=list(self.feature_columns),
            classes=list(self._classes),
            params=dict(self.params),
            metrics=dict(self.metrics),
            metadata=dict(self.metadata),
        )

    @classmethod
    def from_bundle(cls, bundle: ModelBundle) -> "BaseRiskModel":
        """Rebuild a concrete model instance from a persisted bundle.

        Args:
            bundle: Bundle previously produced by :meth:`to_bundle`.

        Returns:
            BaseRiskModel: A ready-to-use, fitted model.

        Raises:
            ModelRegistryError: When the bundle references an unknown model type.
        """
        implementation = MODEL_REGISTRY.get(bundle.model_type)
        if implementation is None:
            raise ModelRegistryError(
                f"The saved model type '{bundle.model_type}' is not registered.",
                details={"available": available_models()},
            )
        model = implementation(feature_columns=bundle.feature_columns, params=bundle.params)
        model._estimator = bundle.estimator
        model._classes = list(bundle.classes)
        model.metrics = dict(bundle.metrics)
        model.metadata = dict(bundle.metadata)
        return model

    def save(self, path: Path, *, dump: Callable[[Any, Path], Any] | None = None) -> Path:
        """Persist the fitted model to disk with joblib.

        Args:
            path: Destination file path.
            dump: Optional serializer override, mainly for testing.

        Returns:
            Path: The path that was written.
        """
        import joblib

        utils.ensure_directory(path.parent)
        serializer = dump or (lambda obj, target: joblib.dump(obj, target))
        serializer(self.to_bundle(), path)
        logger.info("Saved '%s' model to %s", self.model_type, path)
        return path

    @staticmethod
    def load(path: Path) -> "BaseRiskModel":
        """Load a fitted model previously written by :meth:`save`.

        Args:
            path: Path of the serialised bundle.

        Returns:
            BaseRiskModel: The restored model.

        Raises:
            ModelRegistryError: When the artefact is not a recognisable bundle.
        """
        import joblib

        payload = joblib.load(path)
        if isinstance(payload, ModelBundle):
            return BaseRiskModel.from_bundle(payload)
        if isinstance(payload, dict) and "estimator" in payload:
            return BaseRiskModel.from_bundle(ModelBundle(**payload))
        raise ModelRegistryError(
            f"The artefact at {path} is not a supported model bundle.",
            details={"type": type(payload).__name__},
        )
