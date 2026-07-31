"""End-to-end analysis pipeline.

Single place where the four AI stages are wired together::

    video -> extract_feature -> feature_engineering -> predict_model

The API layer only talks to :class:`EyeTrackingPipeline`, which keeps the HTTP
handlers thin and makes the whole flow reusable from scripts and tests.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from app.ai.extract_feature import EyeFeatureExtractor, ExtractionResult
from app.ai.feature_engineering import DatasetRepository, FeatureEngineer, FeatureVector
from app.ai.predict_model import PredictionResult, RiskPredictor, get_predictor
from app.config import Settings, get_settings
from app.logging_config import get_logger

logger = get_logger(__name__)


@dataclass(slots=True)
class AnalysisResult:
    """Everything produced by analysing one recording.

    Attributes:
        extraction: Per-frame extraction output.
        feature_vector: Aggregated features for the recording.
        prediction: Risk prediction, when one was requested and possible.
        dataset_path: Dataset file the sample was appended to, when labelled.
        video_deleted: Whether the source recording was removed after the
            sample joined the dataset.
    """

    extraction: ExtractionResult
    feature_vector: FeatureVector
    prediction: PredictionResult | None = None
    dataset_path: Path | None = None
    video_deleted: bool = False

    def to_dict(self) -> dict[str, Any]:
        """Serialise the analysis into a JSON friendly mapping.

        Returns:
            dict[str, Any]: Plain mapping suitable for API responses.
        """
        payload: dict[str, Any] = {
            "video": self.extraction.metadata.to_dict(),
            "frame_csv_path": (
                str(self.extraction.csv_path) if self.extraction.csv_path else None
            ),
            "blink_count": self.extraction.blink_count,
            "saccade_count": self.extraction.saccade_count,
            "features": dict(self.feature_vector.features),
            "sample_metadata": dict(self.feature_vector.metadata),
            "dataset_path": str(self.dataset_path) if self.dataset_path else None,
            "video_deleted": self.video_deleted,
        }
        if self.prediction is not None:
            payload["prediction"] = self.prediction.to_dict()
        return payload


class EyeTrackingPipeline:
    """Coordinates extraction, feature engineering, dataset writing and inference.

    Attributes:
        settings: Application settings shared by every stage.
        extractor: Landmark extraction stage.
        engineer: Feature aggregation stage.
        dataset_repository: Dataset persistence stage.
        predictor: Inference stage.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        extractor: EyeFeatureExtractor | None = None,
        engineer: FeatureEngineer | None = None,
        dataset_repository: DatasetRepository | None = None,
        predictor: RiskPredictor | None = None,
    ) -> None:
        """Create a pipeline, optionally with injected collaborators.

        Args:
            settings: Settings instance; the cached global settings are used when
                omitted.
            extractor: Landmark extraction stage override.
            engineer: Feature aggregation stage override.
            dataset_repository: Dataset persistence stage override.
            predictor: Inference stage override.
        """
        self.settings: Settings = settings or get_settings()
        self.extractor = extractor or EyeFeatureExtractor(self.settings)
        self.engineer = engineer or FeatureEngineer(self.settings)
        self.dataset_repository = dataset_repository or DatasetRepository(self.settings)
        self.predictor = predictor or get_predictor(self.settings)

    # ------------------------------------------------------------- analysis --
    def analyse(
        self,
        video_path: Path,
        *,
        subject_id: str | None = None,
        age: int | None = None,
        target_trajectory: Sequence[Mapping[str, float]] | None = None,
        label: int | None = None,
        predict: bool = True,
        persist_csv: bool = True,
    ) -> AnalysisResult:
        """Run the full pipeline on a single recording.

        Args:
            video_path: Path of the recorded video.
            subject_id: Optional participant identifier stored with the sample.
            age: Optional participant age, stored as metadata rather than as a
                model feature.
            target_trajectory: Optional stimulus path used for ``tracking_error``.
            label: Supervised target; when provided the sample is appended to
                ``dataset.csv`` for future training.
            predict: Whether to run inference.  Prediction is skipped silently
                when no trained model exists yet.
            persist_csv: Whether to write the per-frame CSV to disk.

        Returns:
            AnalysisResult: Extraction output, features and optional prediction.

        Raises:
            InvalidVideoError: When the file cannot be accepted.
            VideoProcessingError: When the video cannot be decoded.
            NoFaceDetectedError: When too few frames contain a face.
            FeatureExtractionError: When the features cannot be aggregated.
        """
        logger.info("Analysing recording %s (label=%s)", video_path.name, label)

        extraction = self.extractor.extract(video_path, persist_csv=persist_csv)
        feature_vector = self.engineer.build(
            extraction,
            target_trajectory=target_trajectory,
            subject_id=subject_id,
            age=age,
        )

        dataset_path: Path | None = None
        video_deleted = False
        if label is not None:
            dataset_path = self.dataset_repository.append(feature_vector, int(label))
            # Only once the row is safely on disk. Extraction already holds every
            # frame in memory, so nothing downstream reads the file again.
            if self.settings.delete_video_after_dataset_append:
                video_deleted = self._discard_video(video_path)

        prediction: PredictionResult | None = None
        if predict:
            if self.predictor.is_ready:
                prediction = self.predictor.predict(feature_vector)
            else:
                logger.warning(
                    "Prediction skipped: no trained model at %s", self.predictor.model_path
                )

        return AnalysisResult(
            extraction=extraction,
            feature_vector=feature_vector,
            prediction=prediction,
            dataset_path=dataset_path,
            video_deleted=video_deleted,
        )

    def _discard_video(self, video_path: Path) -> bool:
        """Delete a recording whose features have already been persisted.

        The per-frame CSV is deliberately kept: it is what makes a sample
        auditable, and it cannot be turned back into a face. The video can, so
        dropping it saves disk and removes the only irreversibly identifying
        artefact in one step.

        A failure here is logged and swallowed. The sample is already in the
        dataset by this point, so refusing the whole upload over a leftover file
        would throw away good data to punish a disk problem.

        Args:
            video_path: Recording to remove.

        Returns:
            bool: ``True`` when the file was removed.
        """
        try:
            video_path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Could not delete the recording %s", video_path, exc_info=True)
            return False

        logger.info("Deleted the recording %s after appending it to the dataset", video_path.name)
        return True

    def close(self) -> None:
        """Release the native resources held by the extraction stage.

        Returns:
            None
        """
        self.extractor.close()
