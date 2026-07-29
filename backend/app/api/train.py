"""``POST /api/train`` — retrain the risk model from the aggregated dataset."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, status

from app.ai.base import available_models
from app.dependencies import CurrentUserDep, DatasetRepositoryDep, PredictorDep, TrainerDep
from app.logging_config import get_logger
from app.schemas import ErrorResponse, TrainRequest, TrainResponse

logger = get_logger(__name__)

router = APIRouter(tags=["train"])


@router.post(
    "/train",
    response_model=TrainResponse,
    status_code=status.HTTP_200_OK,
    summary="Train the risk model from dataset.csv and persist myeye_model.pkl",
    responses={
        400: {"model": ErrorResponse, "description": "The dataset or model type is unusable."},
        422: {"model": ErrorResponse, "description": "The estimator could not be fitted."},
    },
)
def train(
    user: CurrentUserDep,
    trainer: TrainerDep,
    predictor: PredictorDep,
    payload: TrainRequest | None = None,
) -> TrainResponse:
    """Fit the configured model on ``dataset.csv`` and save the artefact.

    The dataset is split 80/20 (stratified when possible), the estimator is fitted
    on the training part and evaluated on the hold-out part, then serialised with
    joblib.  The in-memory predictor cache is invalidated so the next prediction
    immediately uses the new artefact.

    Args:
        trainer: Injected model trainer.
        predictor: Injected shared predictor whose cache must be refreshed.
        payload: Optional overrides for model type, paths and hyper-parameters.

    Returns:
        TrainResponse: Metrics, artefact location and provenance of the run.

    Raises:
        DatasetError: When the dataset is missing, malformed or too small.
        ModelTrainingError: When the estimator cannot be fitted.
        ModelRegistryError: When an unknown model type is requested.
    """
    request = payload or TrainRequest()
    logger.info(
        "Training requested (model_type=%s, available=%s)",
        request.model_type or trainer.settings.model_type,
        available_models(),
    )

    result = trainer.train(
        model_type=request.model_type,
        dataset_path=Path(request.dataset_path) if request.dataset_path else None,
        model_path=Path(request.model_path) if request.model_path else None,
        params=request.params,
    )
    predictor.invalidate()

    metrics: dict[str, Any] = result.metrics.to_dict()
    return TrainResponse(
        success=True,
        message=(
            f"Trained '{result.model_type}' on {metrics['train_samples']} samples "
            f"(hold-out accuracy {metrics['accuracy']:.3f})."
        ),
        model_type=result.model_type,
        model_path=str(result.model_path),
        dataset_path=str(result.dataset_path),
        feature_columns=result.feature_columns,
        metrics=metrics,
        trained_at=result.trained_at,
    )


@router.get(
    "/train/status",
    summary="Inspect the dataset and the currently trained model",
)
def training_status(
    user: CurrentUserDep,
    dataset_repository: DatasetRepositoryDep,
    predictor: PredictorDep,
) -> dict[str, Any]:
    """Report what the trainer would use on the next run.

    Args:
        dataset_repository: Injected dataset repository.
        predictor: Injected shared predictor.

    Returns:
        dict[str, Any]: Dataset summary, model information and registry contents.
    """
    return {
        "dataset": dataset_repository.summary(),
        "model": predictor.info(),
        "available_models": available_models(),
    }
