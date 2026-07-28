"""``POST /api/predict`` — score a recording (or a raw feature vector)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Query, UploadFile, status

from app.dependencies import (
    HistoryRepositoryDep,
    PipelineDep,
    PredictorDep,
    SettingsDep,
    parse_target_trajectory,
    resolve_stored_video,
    save_upload,
)
from app.exceptions import (
    BadRequestError,
    InvalidVideoError,
    ModelNotTrainedError,
    NotFoundError,
)
from app.logging_config import get_logger
from app.schemas import (
    ErrorResponse,
    HistoryDeleteResponse,
    HistoryListResponse,
    PredictFeaturesRequest,
    PredictResponse,
)

logger = get_logger(__name__)

router = APIRouter(tags=["predict"])

_COMMON_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorResponse, "description": "The request payload was rejected."},
    409: {"model": ErrorResponse, "description": "No trained model is available yet."},
    422: {"model": ErrorResponse, "description": "The recording could not be analysed."},
}


@router.post(
    "/predict",
    response_model=PredictResponse,
    status_code=status.HTTP_200_OK,
    summary="Predict the Alzheimer risk of an eye-tracking recording",
    responses=_COMMON_RESPONSES,
)
async def predict_video(
    settings: SettingsDep,
    pipeline: PipelineDep,
    history_repository: HistoryRepositoryDep,
    file: Annotated[
        UploadFile | None, File(description="Recording to analyse (omit when using 'filename').")
    ] = None,
    filename: Annotated[
        str | None,
        Form(description="Name of a recording previously stored by POST /api/upload."),
    ] = None,
    subject_id: Annotated[str | None, Form(description="Optional participant identifier.")] = None,
    target_trajectory: Annotated[
        str | None,
        Form(description='Stimulus path as JSON, e.g. [{"t":0,"x":0.1,"y":0.5}].'),
    ] = None,
    save_history: Annotated[
        bool, Form(description="Persist the prediction in the test_history table.")
    ] = True,
) -> PredictResponse:
    """Run the full pipeline on a recording and return its risk assessment.

    Either upload a new video through ``file`` or reference an already stored one
    through ``filename``.

    Args:
        settings: Injected application settings.
        pipeline: Injected analysis pipeline.
        history_repository: Injected ``test_history`` repository.
        file: Optional multipart video file to analyse.
        filename: Optional name of a previously uploaded recording.
        subject_id: Optional participant identifier.
        target_trajectory: Optional JSON stimulus path used for ``tracking_error``.
        save_history: Whether to persist the prediction into ``test_history``.

    Returns:
        PredictResponse: Risk score, level, confidence and the features used.

    Raises:
        InvalidVideoError: When neither a file nor a valid filename was supplied.
        ModelNotTrainedError: When no trained artefact is available.
        NoFaceDetectedError: When too few frames contain a detectable face.
    """
    if file is not None and file.filename:
        video_path = await save_upload(file, settings)
    elif filename:
        video_path = resolve_stored_video(filename, settings)
    else:
        raise InvalidVideoError("Provide either a 'file' upload or a stored 'filename'.")

    trajectory = parse_target_trajectory(target_trajectory)

    try:
        analysis = pipeline.analyse(
            video_path,
            subject_id=subject_id,
            target_trajectory=trajectory,
            label=None,
            predict=True,
        )
    finally:
        pipeline.close()

    if analysis.prediction is None:
        raise ModelNotTrainedError(
            "No trained model is available. Call POST /api/train first.",
            details={"model_path": str(settings.model_path)},
        )

    prediction = analysis.prediction
    history_id: int | None = None
    if save_history:
        record = history_repository.create(
            filename=video_path.name,
            risk_score=prediction.risk_score,
            risk_level=prediction.risk_level,
            confidence=prediction.confidence,
            model_type=prediction.model_type,
            subject_id=subject_id,
            features=prediction.features,
            metadata=analysis.feature_vector.metadata,
        )
        history_id = record.id

    return PredictResponse(
        success=True,
        risk_score=round(prediction.risk_score, 4),
        risk_level=prediction.risk_level,
        confidence=round(prediction.confidence, 4),
        model_type=prediction.model_type,
        history_id=history_id,
        filename=video_path.name,
        frame_csv_path=(
            str(analysis.extraction.csv_path) if analysis.extraction.csv_path else None
        ),
        video=analysis.extraction.metadata.to_dict(),
        features=prediction.features,
        sample_metadata=analysis.feature_vector.metadata,
    )


@router.post(
    "/predict/features",
    response_model=PredictResponse,
    status_code=status.HTTP_200_OK,
    summary="Predict directly from a pre-computed feature vector",
    responses=_COMMON_RESPONSES,
)
def predict_from_features(
    payload: PredictFeaturesRequest,
    predictor: PredictorDep,
    history_repository: HistoryRepositoryDep,
) -> PredictResponse:
    """Score an already aggregated feature vector without decoding a video.

    Useful for batch experiments and for validating the model from a notebook.

    Args:
        payload: Feature mapping plus optional bookkeeping fields.
        predictor: Injected shared predictor.
        history_repository: Injected ``test_history`` repository.

    Returns:
        PredictResponse: Risk score, level, confidence and the features used.

    Raises:
        ModelNotTrainedError: When no trained artefact is available.
    """
    prediction = predictor.predict(payload.features)

    history_id: int | None = None
    if payload.save_history:
        record = history_repository.create(
            filename=payload.filename or "features-only",
            risk_score=prediction.risk_score,
            risk_level=prediction.risk_level,
            confidence=prediction.confidence,
            model_type=prediction.model_type,
            subject_id=payload.subject_id,
            features=prediction.features,
            metadata={"source": "features"},
        )
        history_id = record.id

    return PredictResponse(
        success=True,
        risk_score=round(prediction.risk_score, 4),
        risk_level=prediction.risk_level,
        confidence=round(prediction.confidence, 4),
        model_type=prediction.model_type,
        history_id=history_id,
        filename=payload.filename,
        features=prediction.features,
        sample_metadata={"source": "features"},
    )


@router.get(
    "/history",
    response_model=HistoryListResponse,
    summary="List previous risk assessments",
)
def list_history(
    history_repository: HistoryRepositoryDep,
    limit: Annotated[int, Query(ge=1, le=500, description="Page size.")] = 50,
    offset: Annotated[int, Query(ge=0, description="Number of records to skip.")] = 0,
    subject_id: Annotated[
        str | None, Query(description="Only return records of this participant.")
    ] = None,
) -> HistoryListResponse:
    """Return stored assessments, most recent first.

    Args:
        history_repository: Injected ``test_history`` repository.
        limit: Maximum number of records to return.
        offset: Number of records to skip.
        subject_id: Optional participant filter.

    Returns:
        HistoryListResponse: Total count plus the requested page of records.
    """
    records = history_repository.list(limit=limit, offset=offset, subject_id=subject_id)
    return HistoryListResponse(
        total=history_repository.count(),
        limit=limit,
        offset=offset,
        items=[record.to_dict() for record in records],
    )


@router.delete(
    "/history",
    response_model=HistoryDeleteResponse,
    summary="Clear the assessment history",
    responses={400: {"model": ErrorResponse, "description": "The confirmation flag is missing."}},
)
def clear_history(
    history_repository: HistoryRepositoryDep,
    confirm: Annotated[
        bool,
        Query(description="Must be true; guards against an accidental wipe."),
    ] = False,
    subject_id: Annotated[
        str | None, Query(description="Only clear this participant's records.")
    ] = None,
) -> HistoryDeleteResponse:
    """Delete stored assessments, optionally limited to one participant.

    Only the prediction log is affected.  ``dataset.csv``, the trained model and
    the uploaded recordings are separate stores and are left untouched, so
    clearing the history never costs you training data.

    Args:
        history_repository: Injected ``test_history`` repository.
        confirm: Explicit confirmation flag; the call is refused without it.
        subject_id: Optional participant filter.

    Returns:
        HistoryDeleteResponse: Number of rows deleted and the remaining total.

    Raises:
        EyeTrackingError: When ``confirm`` was not set.
    """
    if not confirm:
        raise BadRequestError(
            "Pass confirm=true to clear the assessment history.",
            details={"hint": "DELETE /api/history?confirm=true"},
        )

    deleted = history_repository.delete_all(subject_id=subject_id)
    return HistoryDeleteResponse(
        success=True,
        deleted=deleted,
        remaining=history_repository.count(),
        message=(
            f"ลบผลย้อนหลัง {deleted} รายการแล้ว "
            "(ชุดข้อมูลเทรนและโมเดลไม่ถูกแตะต้อง)"
        ),
    )


@router.delete(
    "/history/{record_id}",
    response_model=HistoryDeleteResponse,
    summary="Delete a single assessment",
    responses={404: {"model": ErrorResponse, "description": "No such record."}},
)
def delete_history_item(
    record_id: int,
    history_repository: HistoryRepositoryDep,
) -> HistoryDeleteResponse:
    """Delete one stored assessment by primary key.

    Args:
        record_id: Primary key of the record to remove.
        history_repository: Injected ``test_history`` repository.

    Returns:
        HistoryDeleteResponse: Deletion counters for the request.

    Raises:
        EyeTrackingError: When the record does not exist.
    """
    if not history_repository.delete(record_id):
        raise NotFoundError(
            f"No assessment with id {record_id}.",
            details={"record_id": record_id},
        )
    return HistoryDeleteResponse(
        success=True,
        deleted=1,
        remaining=history_repository.count(),
        message=f"ลบรายการ #{record_id} แล้ว",
    )
