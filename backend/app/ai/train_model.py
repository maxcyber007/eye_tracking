"""Training service.

Reads ``dataset/dataset.csv``, fits the configured model implementation and
persists the artefact to ``app/models/myeye_model.pkl`` with joblib.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from app.ai import utils
from app.ai.base import BaseRiskModel, TrainingMetrics, available_models, create_model
from app.ai.feature_engineering import DatasetRepository
from app.config import Settings, get_settings
from app.exceptions import DatasetError
from app.logging_config import get_logger

# Importing the estimators module populates the model registry.
from app.ai import estimators as _estimators  # noqa: F401

logger = get_logger(__name__)


@dataclass(slots=True)
class TrainingResult:
    """Outcome of a training run.

    Attributes:
        model_type: Registry key of the fitted implementation.
        model_path: Where the serialised bundle was written.
        dataset_path: Dataset that was used.
        feature_columns: Ordered features the model was fitted on.
        metrics: Hold-out evaluation metrics.
        trained_at: ISO-8601 UTC timestamp of the run.
    """

    model_type: str
    model_path: Path
    dataset_path: Path
    feature_columns: list[str]
    metrics: TrainingMetrics
    trained_at: str

    def to_dict(self) -> dict[str, Any]:
        """Serialise the result into a JSON friendly mapping.

        Returns:
            dict[str, Any]: Plain mapping suitable for API responses.
        """
        return {
            "model_type": self.model_type,
            "model_path": str(self.model_path),
            "dataset_path": str(self.dataset_path),
            "feature_columns": list(self.feature_columns),
            "metrics": self.metrics.to_dict(),
            "trained_at": self.trained_at,
        }


class ModelTrainer:
    """Orchestrates dataset loading, model fitting and artefact persistence.

    Attributes:
        settings: Application settings supplying paths and hyper-parameters.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        """Create a trainer bound to a settings object.

        Args:
            settings: Settings instance; the cached global settings are used when
                omitted.
        """
        self.settings: Settings = settings or get_settings()
        self.dataset_repository = DatasetRepository(self.settings)

    # ------------------------------------------------------------- dataset --
    def load_dataset(self, dataset_path: Path | None = None) -> pd.DataFrame:
        """Load and validate the training dataset.

        Args:
            dataset_path: Optional dataset override; defaults to the configured
                ``dataset/dataset.csv``.

        Returns:
            pandas.DataFrame: Validated dataset.

        Raises:
            DatasetError: When the dataset is missing, empty or lacks columns.
        """
        if dataset_path is None:
            return self.dataset_repository.load()

        path = Path(dataset_path).expanduser().resolve()
        if not path.exists():
            raise DatasetError(f"Dataset not found: {path}", details={"dataset_path": str(path)})
        try:
            frame = pd.read_csv(path)
        except Exception as exc:
            raise DatasetError(f"Could not read the dataset: {exc}") from exc
        if frame.empty:
            raise DatasetError("The dataset is empty.", details={"dataset_path": str(path)})
        return frame

    def prepare_xy(
        self,
        dataset: pd.DataFrame,
        feature_columns: Sequence[str],
    ) -> tuple[pd.DataFrame, np.ndarray]:
        """Split a dataset into a clean feature matrix and a target vector.

        Args:
            dataset: Raw dataset as loaded from CSV.
            feature_columns: Ordered feature names expected by the model.

        Returns:
            tuple[pandas.DataFrame, numpy.ndarray]: ``(features, labels)``.

        Raises:
            DatasetError: When required columns are missing or no row survives
                cleaning.
        """
        label_column = self.settings.label_column
        missing = [column for column in [*feature_columns, label_column] if column not in dataset]
        if missing:
            raise DatasetError(
                "The dataset is missing required columns.",
                details={"missing_columns": missing, "available": list(dataset.columns)},
            )

        frame = dataset[[*feature_columns, label_column]].copy()
        frame = frame.apply(pd.to_numeric, errors="coerce")
        frame[label_column] = frame[label_column].round()
        frame = frame.replace([np.inf, -np.inf], np.nan).dropna(subset=[label_column])
        frame[list(feature_columns)] = frame[list(feature_columns)].fillna(0.0)

        if frame.empty:
            raise DatasetError("No usable row remains after cleaning the dataset.")

        features = frame[list(feature_columns)].astype(float)
        labels = frame[label_column].astype(int).to_numpy()
        return features, labels

    # -------------------------------------------------------------- training --
    def train(
        self,
        *,
        model_type: str | None = None,
        dataset_path: Path | None = None,
        model_path: Path | None = None,
        params: Mapping[str, Any] | None = None,
        feature_columns: Sequence[str] | None = None,
        persist: bool = True,
    ) -> TrainingResult:
        """Train a model and (optionally) persist the resulting artefact.

        Args:
            model_type: Registry key to train; defaults to ``settings.model_type``.
            dataset_path: Optional dataset override.
            model_path: Optional destination override for the artefact.
            params: Hyper-parameter overrides merged over ``settings.model_params``.
            feature_columns: Optional feature-column override.
            persist: Set to ``False`` to skip writing the artefact to disk.

        Returns:
            TrainingResult: Metrics, paths and provenance of the run.

        Raises:
            DatasetError: When the dataset cannot be used.
            ModelTrainingError: When the estimator cannot be fitted.
            ModelRegistryError: When ``model_type`` is unknown.
        """
        settings = self.settings
        resolved_type = model_type or settings.model_type
        columns = list(feature_columns or settings.feature_columns)
        hyper_parameters = {**settings.model_params, **(params or {})}

        logger.info(
            "Training '%s' (available=%s) on %d features",
            resolved_type,
            available_models(),
            len(columns),
        )

        dataset = self.load_dataset(dataset_path)
        features, labels = self.prepare_xy(dataset, columns)

        model = create_model(resolved_type, columns, hyper_parameters)
        metrics = model.fit(features, labels)

        target_path = Path(model_path) if model_path else settings.model_path
        model.metadata = {
            "trained_at": utils.utc_now_iso(),
            "dataset_path": str(dataset_path or settings.dataset_path),
            "dataset_rows": int(len(features)),
            "app_version": settings.app_version,
            "params": hyper_parameters,
        }
        if persist:
            model.save(target_path)

        return TrainingResult(
            model_type=resolved_type,
            model_path=target_path,
            dataset_path=Path(dataset_path or settings.dataset_path),
            feature_columns=columns,
            metrics=metrics,
            trained_at=str(model.metadata["trained_at"]),
        )


def train_model(
    *,
    settings: Settings | None = None,
    model_type: str | None = None,
    dataset_path: Path | None = None,
    model_path: Path | None = None,
    params: Mapping[str, Any] | None = None,
) -> TrainingResult:
    """Convenience wrapper around :meth:`ModelTrainer.train`.

    Args:
        settings: Optional settings override.
        model_type: Registry key to train.
        dataset_path: Optional dataset override.
        model_path: Optional artefact destination override.
        params: Hyper-parameter overrides.

    Returns:
        TrainingResult: Metrics, paths and provenance of the run.
    """
    return ModelTrainer(settings=settings).train(
        model_type=model_type,
        dataset_path=dataset_path,
        model_path=model_path,
        params=params,
    )


def load_trained_model(path: Path) -> BaseRiskModel:
    """Load a persisted model bundle from disk.

    Args:
        path: Path of the serialised bundle.

    Returns:
        BaseRiskModel: The restored, fitted model.
    """
    return BaseRiskModel.load(path)
