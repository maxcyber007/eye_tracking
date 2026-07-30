"""Aggregation of per-frame eye signals into a model-ready feature vector.

The per-frame table produced by :mod:`app.ai.extract_feature` is collapsed into
the ten scalar features listed in :attr:`app.config.Settings.feature_columns`, then
optionally appended to ``dataset/dataset.csv`` for supervised training.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from app.ai import utils
from app.ai.extract_feature import ExtractionResult
from app.config import Settings, get_settings
from app.exceptions import DatasetError, FeatureExtractionError
from app.logging_config import get_logger

logger = get_logger(__name__)

#: Descriptive columns stored alongside the features inside ``dataset.csv``.
METADATA_COLUMNS: tuple[str, ...] = (
    "sample_id",
    "created_at",
    "filename",
    "subject_id",
    "duration",
    "frame_count",
    "fps",
    "detection_ratio",
    "blink_count",
    "saccade_count",
    "fixation_ratio",
    "saccade_ratio",
    "velocity_std",
    "tracking_error_source",
)


@dataclass(slots=True)
class FeatureVector:
    """A single aggregated eye-tracking sample.

    Attributes:
        features: Mapping of feature name to value, ordered like
            :attr:`app.config.Settings.feature_columns`.
        metadata: Descriptive, non-predictive information about the sample.
    """

    features: dict[str, float]
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_frame(self, feature_columns: Sequence[str]) -> pd.DataFrame:
        """Convert the sample into a single-row DataFrame in model column order.

        Args:
            feature_columns: Ordered feature names expected by the estimator.

        Returns:
            pandas.DataFrame: One-row frame containing exactly ``feature_columns``.
        """
        row = {name: float(self.features.get(name, 0.0)) for name in feature_columns}
        return pd.DataFrame([row], columns=list(feature_columns))

    def to_dict(self) -> dict[str, Any]:
        """Serialise features and metadata into a flat JSON friendly mapping.

        Returns:
            dict[str, Any]: Combined features and metadata.
        """
        return {"features": dict(self.features), "metadata": dict(self.metadata)}


class FeatureEngineer:
    """Turn per-frame eye signals into the aggregated feature vector.

    Attributes:
        settings: Application settings supplying thresholds and column order.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        """Create a feature engineer bound to a settings object.

        Args:
            settings: Settings instance; the cached global settings are used when
                omitted.
        """
        self.settings: Settings = settings or get_settings()

    # ------------------------------------------------------------- features --
    def build(
        self,
        extraction: ExtractionResult,
        *,
        target_trajectory: Sequence[Mapping[str, float]] | None = None,
        subject_id: str | None = None,
    ) -> FeatureVector:
        """Aggregate an extraction result into a single feature vector.

        Args:
            extraction: Output of the landmark extraction stage.
            target_trajectory: Optional stimulus path recorded by the frontend, as
                a sequence of mappings with ``t`` (seconds), ``x`` and ``y`` keys.
                When supplied, ``tracking_error`` measures the real gaze-to-target
                residual; otherwise a self-consistency proxy is used.
            subject_id: Optional identifier of the participant.

        Returns:
            FeatureVector: Aggregated features plus descriptive metadata.

        Raises:
            FeatureExtractionError: When the frame table is empty or too short.
        """
        frames = extraction.frames
        if frames is None or frames.empty:
            raise FeatureExtractionError("The per-frame table is empty; nothing to aggregate.")
        if len(frames) < 5:
            raise FeatureExtractionError(
                "The recording is too short to compute reliable features.",
                details={"frame_count": int(len(frames))},
            )

        metadata = extraction.metadata
        timestamps = frames["timestamp"].to_numpy(dtype=float)
        duration = max(float(timestamps[-1] - timestamps[0]), 1e-6)

        speed = utils.nan_to_num_array(frames["velocity"].to_numpy(dtype=float))
        acceleration = utils.nan_to_num_array(frames["acceleration"].to_numpy(dtype=float))
        gaze = np.column_stack(
            (
                utils.nan_to_num_array(frames["gaze_x"].to_numpy(dtype=float)),
                utils.nan_to_num_array(frames["gaze_y"].to_numpy(dtype=float)),
            )
        )

        step_lengths = np.linalg.norm(np.diff(gaze, axis=0), axis=1)
        total_distance = float(np.sum(step_lengths))

        dt = np.diff(timestamps, prepend=timestamps[0] - utils.safe_divide(1.0, metadata.fps, 0.033))
        dt = np.clip(dt, 0.0, None)
        fixation_time = float(np.sum(dt[frames["is_fixation"].to_numpy(dtype=bool)]))

        blink_rate = utils.safe_divide(extraction.blink_count * 60.0, duration, 0.0)
        tracking_error, error_source = self._tracking_error(frames, timestamps, target_trajectory)

        features: dict[str, float] = {
            "eye_velocity": float(np.mean(speed)),
            "eye_acceleration": float(np.mean(np.abs(acceleration))),
            "eye_distance": float(np.mean(frames["eye_distance"].to_numpy(dtype=float))),
            "movement_smoothness": utils.log_dimensionless_jerk(speed, timestamps),
            "blink_rate": blink_rate,
            "fixation_time": fixation_time,
            "total_distance": total_distance,
            "average_velocity": utils.safe_divide(total_distance, duration, 0.0),
            "max_velocity": float(np.max(speed)) if speed.size else 0.0,
            "tracking_error": tracking_error,
        }
        features = {name: utils.to_float(value, 0.0) for name, value in features.items()}

        sample_metadata: dict[str, Any] = {
            "sample_id": utils.build_unique_filename(metadata.path.stem, prefix="s_"),
            "created_at": utils.utc_now_iso(),
            "filename": metadata.path.name,
            "subject_id": subject_id or "",
            "duration": round(duration, 4),
            "frame_count": int(metadata.frame_count),
            "fps": round(metadata.fps, 4),
            "detection_ratio": round(metadata.detection_ratio, 4),
            "blink_count": int(extraction.blink_count),
            "saccade_count": int(extraction.saccade_count),
            "fixation_ratio": round(utils.safe_divide(fixation_time, duration, 0.0), 4),
            "saccade_ratio": round(
                utils.safe_divide(
                    float(np.count_nonzero(frames["is_saccade"].to_numpy(dtype=bool))),
                    float(len(frames)),
                    0.0,
                ),
                4,
            ),
            "velocity_std": round(float(np.std(speed)), 6),
            "tracking_error_source": error_source,
        }

        logger.debug("Built feature vector for %s: %s", metadata.path.name, features)
        return FeatureVector(features=features, metadata=sample_metadata)

    # --------------------------------------------------------- tracking error --
    def _tracking_error(
        self,
        frames: pd.DataFrame,
        timestamps: np.ndarray,
        target_trajectory: Sequence[Mapping[str, float]] | None,
    ) -> tuple[float, str]:
        """Compute how far the gaze deviated from the intended trajectory.

        Two strategies are supported:

        * ``target``  - the frontend supplied the stimulus path.  A least-squares
          affine gaze-to-screen calibration is fitted and the RMS residual after
          calibration is reported.
        * ``self``    - no stimulus path is available.  The RMS deviation between
          the gaze signal and its own low-pass version is reported instead, which
          captures tracking instability and jitter.

        Args:
            frames: Per-frame signal table.
            timestamps: Frame timestamps in seconds.
            target_trajectory: Optional stimulus path from the frontend.

        Returns:
            tuple[float, str]: The tracking error and the strategy that produced it.
        """
        settings = self.settings
        gaze = np.column_stack(
            (
                utils.nan_to_num_array(frames["gaze_x"].to_numpy(dtype=float)),
                utils.nan_to_num_array(frames["gaze_y"].to_numpy(dtype=float)),
            )
        )

        target = self._resample_target(target_trajectory, timestamps)
        if target is not None:
            return utils.affine_residual_rms(gaze, target), "target"

        smoothed = np.column_stack(
            (
                utils.smooth_signal(
                    gaze[:, 0], settings.smoothing_window * 3, settings.smoothing_polyorder
                ),
                utils.smooth_signal(
                    gaze[:, 1], settings.smoothing_window * 3, settings.smoothing_polyorder
                ),
            )
        )
        residual = np.linalg.norm(gaze - smoothed, axis=1)
        return utils.root_mean_square(residual), "self"

    @staticmethod
    def _resample_target(
        target_trajectory: Sequence[Mapping[str, float]] | None,
        timestamps: np.ndarray,
    ) -> np.ndarray | None:
        """Resample the stimulus trajectory onto the video frame timestamps.

        Args:
            target_trajectory: Sequence of ``{"t": .., "x": .., "y": ..}`` points.
            timestamps: Frame timestamps in seconds.

        Returns:
            numpy.ndarray | None: ``(n, 2)`` resampled target path, or ``None``
            when no usable trajectory was supplied.
        """
        if not target_trajectory:
            return None

        points: list[tuple[float, float, float]] = []
        for index, item in enumerate(target_trajectory):
            if not isinstance(item, Mapping):
                continue
            time_value = item.get("t", item.get("timestamp", index))
            x_value = item.get("x")
            y_value = item.get("y")
            if x_value is None or y_value is None:
                continue
            points.append(
                (
                    utils.to_float(time_value, float(index)),
                    utils.to_float(x_value, 0.0),
                    utils.to_float(y_value, 0.0),
                )
            )

        if len(points) < 3:
            logger.warning("Target trajectory has fewer than 3 usable points; ignoring it.")
            return None

        points.sort(key=lambda item: item[0])
        array = np.asarray(points, dtype=float)
        times, xs, ys = array[:, 0], array[:, 1], array[:, 2]
        if times[-1] > 1000.0:  # Frontends often report milliseconds.
            times = times / 1000.0
        times = times - times[0]

        resampled = np.column_stack(
            (np.interp(timestamps, times, xs), np.interp(timestamps, times, ys))
        )
        return utils.normalise_unit_range(resampled)


class DatasetRepository:
    """Read/write access to the aggregated training dataset (``dataset.csv``).

    Attributes:
        settings: Application settings holding the dataset path and columns.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        """Create a dataset repository bound to a settings object.

        Args:
            settings: Settings instance; the cached global settings are used when
                omitted.
        """
        self.settings: Settings = settings or get_settings()

    @property
    def path(self) -> Path:
        """Absolute path of the dataset CSV file."""
        return self.settings.dataset_path

    @property
    def columns(self) -> list[str]:
        """Full ordered column list of the dataset CSV."""
        return [
            *METADATA_COLUMNS,
            *self.settings.feature_columns,
            self.settings.label_column,
        ]

    def exists(self) -> bool:
        """Report whether the dataset file is present on disk.

        Returns:
            bool: ``True`` when the dataset CSV exists.
        """
        return self.path.exists()

    def load(self) -> pd.DataFrame:
        """Load the dataset from disk.

        Returns:
            pandas.DataFrame: The dataset contents.

        Raises:
            DatasetError: When the file is missing, empty or unreadable.
        """
        if not self.exists():
            raise DatasetError(
                f"Dataset not found at {self.path}. Upload labelled recordings first.",
                details={"dataset_path": str(self.path)},
            )
        try:
            frame = pd.read_csv(self.path)
        except Exception as exc:
            raise DatasetError(f"Could not read the dataset: {exc}") from exc

        if frame.empty:
            raise DatasetError("The dataset is empty.", details={"dataset_path": str(self.path)})
        return frame

    def append(self, sample: FeatureVector, label: int) -> Path:
        """Append one labelled sample to the dataset, creating the file if needed.

        Args:
            sample: Aggregated feature vector to persist.
            label: Supervised target (``0`` = control, ``1`` = at risk).

        Returns:
            Path: Path of the dataset file that was written.
        """
        utils.ensure_directory(self.path.parent)
        row: dict[str, Any] = {name: sample.metadata.get(name, "") for name in METADATA_COLUMNS}
        row.update({name: sample.features.get(name, 0.0) for name in self.settings.feature_columns})
        row[self.settings.label_column] = int(label)

        frame = pd.DataFrame([row], columns=self.columns)
        header = not self.path.exists() or self.path.stat().st_size == 0
        frame.to_csv(self.path, mode="a", header=header, index=False)
        logger.info("Appended sample %s (label=%d) to %s", row["sample_id"], label, self.path)
        return self.path

    def append_frame(self, frame: pd.DataFrame) -> int:
        """Append a whole dataframe of ready-made rows to the dataset.

        The frame is reindexed onto :attr:`columns` first, so a caller that
        produced its rows from a different column order — or that is missing an
        optional metadata column — cannot silently corrupt the CSV layout.

        Args:
            frame: Rows to append; must already carry the feature and label
                columns.

        Returns:
            int: Number of rows written.
        """
        utils.ensure_directory(self.path.parent)
        aligned = frame.reindex(columns=self.columns)

        header = not self.path.exists() or self.path.stat().st_size == 0
        aligned.to_csv(self.path, mode="a", header=header, index=False)
        logger.info("Appended %d rows to %s", len(aligned), self.path)
        return int(len(aligned))

    def replace_frame(self, frame: pd.DataFrame) -> int:
        """Overwrite the dataset with the supplied rows.

        Args:
            frame: Rows that become the complete new dataset.

        Returns:
            int: Number of rows written.
        """
        utils.ensure_directory(self.path.parent)
        aligned = frame.reindex(columns=self.columns)
        aligned.to_csv(self.path, mode="w", header=True, index=False)
        logger.info("Replaced %s with %d rows", self.path, len(aligned))
        return int(len(aligned))

    def delete(self) -> int:
        """Delete the dataset file.

        Deleting rather than truncating keeps ``summary()['exists']`` honest:
        an empty file with only a header would report as an existing dataset
        that then fails to load.

        Returns:
            int: Number of rows that were discarded; ``0`` when there was no
            dataset to begin with.
        """
        if not self.exists():
            return 0

        try:
            rows = int(len(pd.read_csv(self.path)))
        except Exception:  # pragma: no cover - corrupted file, delete it anyway
            logger.warning("Dataset at %s is unreadable; deleting it", self.path, exc_info=True)
            rows = 0

        self.path.unlink()
        logger.info("Deleted the dataset at %s (%d rows discarded)", self.path, rows)
        return rows

    def summary(self) -> dict[str, Any]:
        """Summarise the dataset without raising when it does not exist yet.

        Returns:
            dict[str, Any]: Row count, per-class counts and the dataset path.
        """
        if not self.exists():
            return {"exists": False, "path": str(self.path), "rows": 0, "label_counts": {}}
        try:
            frame = pd.read_csv(self.path)
        except Exception:  # pragma: no cover - corrupted file
            logger.warning("Dataset at %s is unreadable", self.path, exc_info=True)
            return {"exists": True, "path": str(self.path), "rows": 0, "label_counts": {}}

        label_column = self.settings.label_column
        counts = (
            frame[label_column].value_counts().sort_index().to_dict()
            if label_column in frame.columns
            else {}
        )
        return {
            "exists": True,
            "path": str(self.path),
            "rows": int(len(frame)),
            "label_counts": {str(key): int(value) for key, value in counts.items()},
        }


def build_feature_vector(
    extraction: ExtractionResult,
    *,
    settings: Settings | None = None,
    target_trajectory: Sequence[Mapping[str, float]] | None = None,
    subject_id: str | None = None,
) -> FeatureVector:
    """Convenience wrapper around :meth:`FeatureEngineer.build`.

    Args:
        extraction: Output of the landmark extraction stage.
        settings: Optional settings override.
        target_trajectory: Optional stimulus path recorded by the frontend.
        subject_id: Optional participant identifier.

    Returns:
        FeatureVector: Aggregated features plus descriptive metadata.
    """
    return FeatureEngineer(settings=settings).build(
        extraction,
        target_trajectory=target_trajectory,
        subject_id=subject_id,
    )
