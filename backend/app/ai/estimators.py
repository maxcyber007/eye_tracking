"""Concrete risk-model implementations.

Only scikit-learn estimators live here today.  A future sequence model (LSTM,
Transformer, PyTorch) simply adds another class in this module — or in its own
module imported from :mod:`app.ai` — decorated with
:func:`app.ai.base.register_model`.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split

from app.ai.base import BaseRiskModel, TrainingMetrics, register_model
from app.config import get_settings
from app.exceptions import ModelTrainingError
from app.logging_config import get_logger

logger = get_logger(__name__)


class SklearnRiskModel(BaseRiskModel):
    """Shared training/inference logic for scikit-learn classifiers.

    Subclasses only need to implement :meth:`build_estimator`.
    """

    def __init__(
        self,
        feature_columns: Sequence[str],
        params: Mapping[str, Any] | None = None,
    ) -> None:
        """Create an untrained scikit-learn backed model.

        Args:
            feature_columns: Ordered feature names the model consumes.
            params: Hyper-parameters forwarded to the scikit-learn estimator.
        """
        super().__init__(feature_columns=feature_columns, params=params)

    # ----------------------------------------------------------------- fit --
    def fit(self, features: pd.DataFrame, labels: np.ndarray) -> TrainingMetrics:
        """Fit the classifier on a stratified 80/20 split and score the hold-out.

        Args:
            features: Training features, one row per sample.
            labels: Supervised targets aligned with ``features``.

        Returns:
            TrainingMetrics: Metrics computed on the hold-out split.

        Raises:
            ModelTrainingError: When the dataset is too small or single-class.
        """
        settings = get_settings()
        x = self.align_features(features)
        y = np.asarray(labels).ravel()

        if len(x) != len(y):
            raise ModelTrainingError("Features and labels have different lengths.")
        if len(x) < 4:
            raise ModelTrainingError(
                "At least 4 labelled samples are required to train a model.",
                details={"samples": int(len(x))},
            )

        unique, counts = np.unique(y, return_counts=True)
        if unique.size < 2:
            raise ModelTrainingError(
                "The dataset contains a single class; both control and at-risk "
                "recordings are required.",
                details={"classes": unique.tolist()},
            )

        stratify = y if counts.min() >= 2 else None
        if stratify is None:
            logger.warning("A class has fewer than 2 samples; falling back to a random split.")

        x_train, x_test, y_train, y_test = train_test_split(
            x,
            y,
            test_size=settings.test_size,
            random_state=settings.random_state,
            stratify=stratify,
        )
        if len(np.unique(y_train)) < 2:  # Degenerate split on a tiny dataset.
            x_train, y_train = x, y

        estimator = self.build_estimator()
        try:
            estimator.fit(x_train, y_train)
        except Exception as exc:
            raise ModelTrainingError(f"The estimator could not be fitted: {exc}") from exc

        self._estimator = estimator
        self._classes = [int(value) for value in getattr(estimator, "classes_", unique)]

        y_pred = estimator.predict(x_test)
        metrics = TrainingMetrics(
            accuracy=float(accuracy_score(y_test, y_pred)),
            precision=float(precision_score(y_test, y_pred, average="weighted", zero_division=0)),
            recall=float(recall_score(y_test, y_pred, average="weighted", zero_division=0)),
            f1_score=float(f1_score(y_test, y_pred, average="weighted", zero_division=0)),
            roc_auc=self._roc_auc(estimator, x_test, y_test),
            cv_mean_accuracy=self._cross_validate(x, y, counts.min()),
            train_samples=int(len(x_train)),
            test_samples=int(len(x_test)),
            class_distribution={
                str(int(label)): int(count) for label, count in zip(unique, counts)
            },
            confusion_matrix=confusion_matrix(y_test, y_pred).tolist(),
            feature_importance=self.feature_importance(),
        )
        self.metrics = metrics.to_dict()
        logger.info(
            "Trained '%s' on %d samples (accuracy=%.3f, f1=%.3f)",
            self.model_type,
            len(x),
            metrics.accuracy,
            metrics.f1_score,
        )
        return metrics

    # ----------------------------------------------------------- inference --
    def predict_proba(self, features: pd.DataFrame) -> np.ndarray:
        """Return per-class probabilities for each input row.

        Args:
            features: Feature rows to score.

        Returns:
            numpy.ndarray: ``(n_samples, n_classes)`` probability matrix.

        Raises:
            ModelTrainingError: When the model has not been fitted yet.
        """
        if self._estimator is None:
            raise ModelTrainingError("The model has not been fitted yet.")
        aligned = self.align_features(features)
        return np.asarray(self._estimator.predict_proba(aligned), dtype=float)

    # ------------------------------------------------------------- helpers --
    @staticmethod
    def _roc_auc(estimator: Any, x_test: pd.DataFrame, y_test: np.ndarray) -> float | None:
        """Compute the ROC AUC of the hold-out split when it is well defined.

        Args:
            estimator: Fitted scikit-learn estimator.
            x_test: Hold-out features.
            y_test: Hold-out targets.

        Returns:
            float | None: ROC AUC, or ``None`` when it cannot be computed.
        """
        try:
            if len(np.unique(y_test)) < 2:
                return None
            probabilities = estimator.predict_proba(x_test)
            if probabilities.shape[1] == 2:
                return float(roc_auc_score(y_test, probabilities[:, 1]))
            return float(
                roc_auc_score(y_test, probabilities, multi_class="ovr", average="weighted")
            )
        except Exception:  # pragma: no cover - metric is best-effort only
            logger.debug("ROC AUC could not be computed", exc_info=True)
            return None

    def _cross_validate(self, x: pd.DataFrame, y: np.ndarray, min_class_count: int) -> float | None:
        """Run stratified cross-validation when the dataset is large enough.

        Args:
            x: Full feature matrix.
            y: Full target vector.
            min_class_count: Size of the smallest class.

        Returns:
            float | None: Mean CV accuracy, or ``None`` when it is not applicable.
        """
        settings = get_settings()
        folds = int(min(settings.cv_folds, min_class_count))
        if folds < 2 or len(x) < folds * 2:
            return None
        try:
            splitter = StratifiedKFold(
                n_splits=folds, shuffle=True, random_state=settings.random_state
            )
            scores = cross_val_score(self.build_estimator(), x, y, cv=splitter, scoring="accuracy")
            return float(np.mean(scores))
        except Exception:  # pragma: no cover - metric is best-effort only
            logger.debug("Cross-validation could not be computed", exc_info=True)
            return None


@register_model
class RandomForestRiskModel(SklearnRiskModel):
    """Default risk model: a RandomForest classifier over the aggregated features."""

    model_type = "random_forest"

    def build_estimator(self) -> RandomForestClassifier:
        """Instantiate an untrained RandomForest with the configured parameters.

        Returns:
            RandomForestClassifier: Fresh, unfitted estimator.
        """
        settings = get_settings()
        params: dict[str, Any] = {
            "n_estimators": 300,
            "class_weight": "balanced",
            "n_jobs": -1,
            **self.params,
        }
        params.setdefault("random_state", settings.random_state)
        return RandomForestClassifier(**params)


@register_model
class GradientBoostingRiskModel(SklearnRiskModel):
    """Alternative baseline used to sanity-check the RandomForest results."""

    model_type = "gradient_boosting"

    def build_estimator(self) -> GradientBoostingClassifier:
        """Instantiate an untrained GradientBoosting classifier.

        Returns:
            GradientBoostingClassifier: Fresh, unfitted estimator.
        """
        settings = get_settings()
        params: dict[str, Any] = {"n_estimators": 200, "learning_rate": 0.05, **self.params}
        params.setdefault("random_state", settings.random_state)
        # Parameters that only make sense for RandomForest are dropped silently.
        for unsupported in ("class_weight", "n_jobs", "bootstrap", "oob_score"):
            params.pop(unsupported, None)
        return GradientBoostingClassifier(**params)
