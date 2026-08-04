"""``POST /api/predict`` — score a recording (or a raw feature vector)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Query, UploadFile, status

from app.database import HistoryFilter
from app.dependencies import (
    CurrentUserDep,
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
from app.config import Settings
from app.schemas import (
    MAX_AGE,
    MIN_AGE,
    ErrorResponse,
    HistoryDeleteResponse,
    HistoryListResponse,
    PredictFeaturesRequest,
    PredictResponse,
    RiskBand,
    build_risk_bands,
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
    age: Annotated[
        int | None,
        Form(ge=MIN_AGE, le=MAX_AGE, description="Participant age in years. Stored, not modelled."),
    ] = None,
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
        age: Optional participant age; recorded so reports can be stratified,
            and deliberately not used as a model feature.
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
            age=age,
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
            age=age,
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
        risk_bands=_risk_bands(settings),
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
    settings: SettingsDep,
    predictor: PredictorDep,
    history_repository: HistoryRepositoryDep,
) -> PredictResponse:
    """Score an already aggregated feature vector without decoding a video.

    Useful for batch experiments and for validating the model from a notebook.

    Args:
        payload: Feature mapping plus optional bookkeeping fields.
        settings: Injected application settings. Read through the dependency
            rather than off the predictor, whose copy is captured once when the
            process-wide singleton is built and would go stale on a reload.
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
            age=payload.age,
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
        risk_bands=_risk_bands(settings),
    )


def _risk_bands(settings: Settings) -> list[RiskBand]:
    """Build the band table from the settings that produced the score.

    Args:
        settings: Application settings holding the thresholds and labels.

    Returns:
        list[RiskBand]: Bands ordered from lowest to highest.
    """
    return build_risk_bands(
        settings.risk_threshold_low,
        settings.risk_threshold_moderate,
        settings.risk_level_labels,
    )


def _history_filter(
    subject_id: str | None, age_min: int | None, age_max: int | None
) -> HistoryFilter:
    """Build a history filter, rejecting an inverted age range.

    An inverted range matches nothing, so silently accepting it would show an
    empty report that looks like "no data" rather than "impossible filter" — and
    on the delete path it would quietly remove nothing at all.

    Args:
        subject_id: Optional participant filter.
        age_min: Lowest age to include, inclusive.
        age_max: Highest age to include, inclusive.

    Returns:
        HistoryFilter: Validated criteria.

    Raises:
        BadRequestError: When ``age_min`` exceeds ``age_max``.
    """
    if age_min is not None and age_max is not None and age_min > age_max:
        raise BadRequestError(
            f"age_min ({age_min}) cannot be greater than age_max ({age_max}).",
            details={"age_min": age_min, "age_max": age_max},
        )
    return HistoryFilter(subject_id=subject_id or None, age_min=age_min, age_max=age_max)


@router.get(
    "/history",
    response_model=HistoryListResponse,
    summary="List previous risk assessments",
)
def list_history(
    user: CurrentUserDep,
    history_repository: HistoryRepositoryDep,
    limit: Annotated[int, Query(ge=1, le=500, description="Page size.")] = 50,
    offset: Annotated[int, Query(ge=0, description="Number of records to skip.")] = 0,
    subject_id: Annotated[
        str | None, Query(description="Only return records of this participant.")
    ] = None,
    age_min: Annotated[
        int | None,
        Query(ge=MIN_AGE, le=MAX_AGE, description="Lowest participant age to include."),
    ] = None,
    age_max: Annotated[
        int | None,
        Query(ge=MIN_AGE, le=MAX_AGE, description="Highest participant age to include."),
    ] = None,
) -> HistoryListResponse:
    """Return stored assessments, most recent first.

    Filtering by age excludes assessments recorded before the age field existed,
    because their age is genuinely unknown rather than zero.

    Args:
        history_repository: Injected ``test_history`` repository.
        limit: Maximum number of records to return.
        offset: Number of records to skip.
        subject_id: Optional participant filter.
        age_min: Lowest age to include, inclusive.
        age_max: Highest age to include, inclusive.

    Returns:
        HistoryListResponse: Total count, the requested page and the age span
        present in the whole log.

    Raises:
        BadRequestError: When the age bounds are inverted.
    """
    filters = _history_filter(subject_id, age_min, age_max)
    records = history_repository.list(limit=limit, offset=offset, filters=filters)
    low, high = history_repository.age_range()

    return HistoryListResponse(
        # The total must honour the filter, otherwise paging past the last
        # filtered page shows an empty table with a stale "of N" count.
        total=history_repository.count(filters=filters),
        limit=limit,
        offset=offset,
        items=[record.to_dict() for record in records],
        # Unfiltered, so the report can bound its age control to ages that
        # actually exist instead of an arbitrary slider.
        age_min_available=low,
        age_max_available=high,
    )


@router.delete(
    "/history",
    response_model=HistoryDeleteResponse,
    summary="Clear the assessment history",
    responses={400: {"model": ErrorResponse, "description": "The confirmation flag is missing."}},
)
def clear_history(
    user: CurrentUserDep,
    history_repository: HistoryRepositoryDep,
    confirm: Annotated[
        bool,
        Query(description="Must be true; guards against an accidental wipe."),
    ] = False,
    subject_id: Annotated[
        str | None, Query(description="Only clear this participant's records.")
    ] = None,
    age_min: Annotated[
        int | None,
        Query(ge=MIN_AGE, le=MAX_AGE, description="Only clear records at or above this age."),
    ] = None,
    age_max: Annotated[
        int | None,
        Query(ge=MIN_AGE, le=MAX_AGE, description="Only clear records at or below this age."),
    ] = None,
) -> HistoryDeleteResponse:
    """Delete stored assessments, optionally limited by participant and age.

    The filter is the same one the listing uses, so what you see in a filtered
    report is exactly what a filtered clear removes.

    Only the prediction log is affected.  ``dataset.csv``, the trained model and
    the uploaded recordings are separate stores and are left untouched, so
    clearing the history never costs you training data.

    Args:
        history_repository: Injected ``test_history`` repository.
        confirm: Explicit confirmation flag; the call is refused without it.
        subject_id: Optional participant filter.
        age_min: Lowest age to clear, inclusive.
        age_max: Highest age to clear, inclusive.

    Returns:
        HistoryDeleteResponse: Number of rows deleted and the remaining total.

    Raises:
        EyeTrackingError: When ``confirm`` was not set.
        BadRequestError: When the age bounds are inverted.
    """
    if not confirm:
        raise BadRequestError(
            "Pass confirm=true to clear the assessment history.",
            details={"hint": "DELETE /api/history?confirm=true"},
        )

    deleted = history_repository.delete_all(
        filters=_history_filter(subject_id, age_min, age_max)
    )
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
    user: CurrentUserDep,
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
