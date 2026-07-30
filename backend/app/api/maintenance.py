"""Dataset and model maintenance endpoints.

These are the destructive and the fabricating operations, deliberately kept in
their own module and behind their own ``ตั้งค่า`` page rather than mixed into
the training routes.  Every one of them either destroys data or writes rows
that are not real measurements, so they should be hard to reach by accident.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, status

from app.ai.synthetic import build_samples
from app.dependencies import CurrentUserDep, DatasetRepositoryDep, PredictorDep, SettingsDep
from app.exceptions import BadRequestError
from app.logging_config import get_logger
from app.schemas import (
    DatasetDeleteResponse,
    ErrorResponse,
    MockDatasetRequest,
    MockDatasetResponse,
    ModelDeleteResponse,
)

logger = get_logger(__name__)

router = APIRouter(tags=["maintenance"])


@router.post(
    "/dataset/mock",
    response_model=MockDatasetResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate synthetic rows so the pipeline can be trained and demonstrated",
    responses={400: {"model": ErrorResponse, "description": "The parameters were rejected."}},
)
def generate_mock_dataset(
    user: CurrentUserDep,
    dataset_repository: DatasetRepositoryDep,
    payload: MockDatasetRequest | None = None,
) -> MockDatasetResponse:
    """Write fabricated samples into ``dataset.csv``.

    The rows are drawn from per-class distributions loosely based on published
    smooth-pursuit effect directions.  **They are not measurements.** A model
    trained on them proves only that the software runs; it carries no clinical
    meaning, which is why every generated row is stamped with a ``synthetic_``
    sample id that stays visible in the dataset.

    Appending keeps the sample ids unique by continuing after the current row
    count, so a second batch never collides with the first.

    Args:
        user: Injected signed-in account.
        dataset_repository: Injected dataset repository.
        payload: Sample count, class balance, seed and append flag.

    Returns:
        MockDatasetResponse: Row count written and the dataset summary after.

    Raises:
        BadRequestError: When the parameters cannot produce a usable dataset.
    """
    request = payload or MockDatasetRequest()

    # Continue the id sequence when appending, so ids stay unique across batches.
    start_index = int(dataset_repository.summary().get("rows", 0)) if request.append else 0

    try:
        frame = build_samples(
            request.samples,
            request.positive_ratio,
            request.seed,
            settings=dataset_repository.settings,
            start_index=start_index,
        )
    except ValueError as exc:
        raise BadRequestError(str(exc)) from exc

    if request.append:
        written = dataset_repository.append_frame(frame)
    else:
        written = dataset_repository.replace_frame(frame)

    summary = dataset_repository.summary()
    logger.info(
        "Generated %d synthetic samples (append=%s) for user '%s'",
        written,
        request.append,
        user.username,
    )

    verb = "เพิ่ม" if request.append else "สร้าง"
    return MockDatasetResponse(
        success=True,
        generated=written,
        appended=request.append,
        dataset_path=str(dataset_repository.path),
        dataset=summary,
        message=(
            f"{verb}ข้อมูลจำลอง {written} ตัวอย่างแล้ว "
            f"(รวมทั้งหมด {summary.get('rows', 0)} ตัวอย่าง) — "
            "ข้อมูลนี้ถูกสร้างขึ้น ไม่ใช่การวัดจริง"
        ),
    )


@router.delete(
    "/dataset",
    response_model=DatasetDeleteResponse,
    status_code=status.HTTP_200_OK,
    summary="Delete dataset.csv",
    responses={400: {"model": ErrorResponse, "description": "Confirmation was missing."}},
)
def delete_dataset(
    user: CurrentUserDep,
    dataset_repository: DatasetRepositoryDep,
    confirm: Annotated[
        bool,
        Query(description="Must be true; guards against an accidental wipe."),
    ] = False,
) -> DatasetDeleteResponse:
    """Remove the aggregated training dataset.

    Only ``dataset.csv`` is affected.  The uploaded recordings, their per-frame
    CSVs, the trained model and the assessment history are separate stores and
    are left untouched — but the labelled samples themselves are gone, and
    nothing in the app can rebuild them from the recordings.

    Args:
        user: Injected signed-in account.
        dataset_repository: Injected dataset repository.
        confirm: Explicit confirmation flag; the call is refused without it.

    Returns:
        DatasetDeleteResponse: Number of rows that were discarded.

    Raises:
        BadRequestError: When ``confirm`` was not set.
    """
    if not confirm:
        raise BadRequestError(
            "Pass confirm=true to delete the dataset.",
            details={"hint": "DELETE /api/dataset?confirm=true"},
        )

    deleted = dataset_repository.delete()
    logger.info("User '%s' deleted the dataset (%d rows)", user.username, deleted)

    return DatasetDeleteResponse(
        success=True,
        deleted=deleted,
        dataset_path=str(dataset_repository.path),
        message=(
            f"ลบชุดข้อมูล {deleted} ตัวอย่างแล้ว (โมเดลและผลย้อนหลังไม่ถูกแตะต้อง)"
            if deleted
            else "ไม่มีชุดข้อมูลให้ลบอยู่แล้ว"
        ),
    )


@router.delete(
    "/model",
    response_model=ModelDeleteResponse,
    status_code=status.HTTP_200_OK,
    summary="Delete the trained model so it can be retrained from scratch",
    responses={400: {"model": ErrorResponse, "description": "Confirmation was missing."}},
)
def delete_model(
    user: CurrentUserDep,
    predictor: PredictorDep,
    settings: SettingsDep,
    confirm: Annotated[
        bool,
        Query(description="Must be true; guards against an accidental deletion."),
    ] = False,
) -> ModelDeleteResponse:
    """Remove the serialised model artefact and drop the in-memory cache.

    Until a new model is trained, ``POST /api/predict`` answers ``409
    ModelNotTrainedError`` and the assessment page will say the system is not
    ready.  Labelled uploads still work: they keep appending to ``dataset.csv``,
    they just come back without a prediction.

    Args:
        user: Injected signed-in account.
        predictor: Injected shared predictor.
        settings: Injected application settings.
        confirm: Explicit confirmation flag; the call is refused without it.

    Returns:
        ModelDeleteResponse: Whether an artefact was actually removed.

    Raises:
        BadRequestError: When ``confirm`` was not set.
    """
    if not confirm:
        raise BadRequestError(
            "Pass confirm=true to delete the trained model.",
            details={"hint": "DELETE /api/model?confirm=true"},
        )

    deleted = predictor.delete()
    logger.info("User '%s' deleted the model (existed=%s)", user.username, deleted)

    return ModelDeleteResponse(
        success=True,
        deleted=deleted,
        model_path=str(settings.model_path),
        message=(
            "ลบโมเดลแล้ว ระบบจะยังทำนายไม่ได้จนกว่าจะเทรนใหม่"
            if deleted
            else "ไม่มีโมเดลให้ลบอยู่แล้ว"
        ),
    )
