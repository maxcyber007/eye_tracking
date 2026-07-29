"""``POST /api/upload`` — receive a recording and run the analysis pipeline."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile, status

from app.dependencies import (
    CurrentUserDep,
    HistoryRepositoryDep,
    PipelineDep,
    SettingsDep,
    parse_target_trajectory,
    save_upload,
)
from app.logging_config import get_logger
from app.schemas import ErrorResponse, UploadResponse

logger = get_logger(__name__)

router = APIRouter(tags=["upload"])


@router.post(
    "/upload",
    response_model=UploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an eye-tracking recording and extract its features",
    responses={
        400: {"model": ErrorResponse, "description": "The uploaded file was rejected."},
        422: {"model": ErrorResponse, "description": "The recording could not be analysed."},
    },
)
async def upload_video(
    user: CurrentUserDep,
    settings: SettingsDep,
    pipeline: PipelineDep,
    history_repository: HistoryRepositoryDep,
    file: Annotated[UploadFile, File(description="Front-camera recording of the pursuit task.")],
    subject_id: Annotated[str | None, Form(description="Optional participant identifier.")] = None,
    label: Annotated[
        int | None,
        Form(description="Supervised target (0 = control, 1 = at risk). Appends to dataset.csv."),
    ] = None,
    target_trajectory: Annotated[
        str | None,
        Form(description='Stimulus path as JSON, e.g. [{"t":0,"x":0.1,"y":0.5}].'),
    ] = None,
    predict: Annotated[
        bool, Form(description="Also run inference when a trained model exists.")
    ] = True,
    save_history: Annotated[
        bool, Form(description="Persist the prediction in the test_history table.")
    ] = True,
) -> UploadResponse:
    """Store a recording, extract its eye-tracking features and optionally score it.

    Workflow: persist the upload, decode every frame with OpenCV, locate the eye
    landmarks with MediaPipe FaceMesh, write ``<video>_output.csv``, aggregate the
    ten features and — when ``label`` is given — append the sample to
    ``dataset/dataset.csv``.

    Args:
        settings: Injected application settings.
        pipeline: Injected analysis pipeline.
        history_repository: Injected ``test_history`` repository.
        file: Multipart video file recorded by the frontend.
        subject_id: Optional participant identifier stored with the sample.
        label: Supervised target; when present the sample joins the dataset.
        target_trajectory: Optional JSON stimulus path used for ``tracking_error``.
        predict: Whether to run inference after feature extraction.
        save_history: Whether to persist the prediction into ``test_history``.

    Returns:
        UploadResponse: Stored paths, video metadata, features and prediction.

    Raises:
        InvalidVideoError: When the upload is missing, empty or unsupported.
        VideoProcessingError: When the video cannot be decoded.
        NoFaceDetectedError: When too few frames contain a detectable face.
    """
    stored_path = await save_upload(file, settings)
    trajectory = parse_target_trajectory(target_trajectory)

    try:
        analysis = pipeline.analyse(
            stored_path,
            subject_id=subject_id,
            target_trajectory=trajectory,
            label=label,
            predict=predict,
        )
    finally:
        pipeline.close()

    payload = analysis.to_dict()
    prediction = analysis.prediction

    if prediction is not None and save_history:
        record = history_repository.create(
            filename=stored_path.name,
            risk_score=prediction.risk_score,
            risk_level=prediction.risk_level,
            confidence=prediction.confidence,
            model_type=prediction.model_type,
            subject_id=subject_id,
            features=prediction.features,
            metadata=analysis.feature_vector.metadata,
        )
        payload.setdefault("prediction", {})["history_id"] = record.id

    message = (
        f"Processed {analysis.extraction.metadata.frame_count} frames from "
        f"{stored_path.name}."
    )
    if label is not None:
        message += " The labelled sample was appended to the training dataset."
    if prediction is None and predict:
        message += " No trained model is available yet, so no risk score was computed."

    return UploadResponse(
        success=True,
        message=message,
        filename=stored_path.name,
        stored_path=str(stored_path),
        frame_csv_path=payload["frame_csv_path"],
        dataset_path=payload["dataset_path"],
        video=payload["video"],
        blink_count=payload["blink_count"],
        saccade_count=payload["saccade_count"],
        features=payload["features"],
        sample_metadata=payload["sample_metadata"],
        prediction=payload.get("prediction"),
    )
