"""Frame-by-frame eye landmark extraction.

Pipeline implemented here::

    video file -> OpenCV frame loop -> MediaPipe FaceMesh -> eye landmarks
               -> per-frame signals -> ``<video>_output.csv``

The module is deliberately free of any FastAPI import so it can be reused from
notebooks, batch scripts or a future training pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final, Sequence

import numpy as np
import pandas as pd

from app.ai import utils
from app.config import Settings, get_settings
from app.exceptions import (
    InvalidVideoError,
    NoFaceDetectedError,
    VideoProcessingError,
)
from app.logging_config import get_logger

logger = get_logger(__name__)

# --------------------------------------------------------------------------- #
# MediaPipe FaceMesh landmark indices (468 mesh points + 10 refined iris points)
# --------------------------------------------------------------------------- #
#: Iris ring of the eye that appears on the *left* side of the mirrored image.
LEFT_IRIS_INDICES: Final[tuple[int, ...]] = (468, 469, 470, 471, 472)
#: Iris ring of the eye that appears on the *right* side of the mirrored image.
RIGHT_IRIS_INDICES: Final[tuple[int, ...]] = (473, 474, 475, 476, 477)

#: Full eyelid contour of the left eye, used as an iris fallback.
LEFT_EYE_CONTOUR: Final[tuple[int, ...]] = (
    33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
)
#: Full eyelid contour of the right eye, used as an iris fallback.
RIGHT_EYE_CONTOUR: Final[tuple[int, ...]] = (
    362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398,
)

#: Six points (p1..p6) feeding the left Eye Aspect Ratio.
LEFT_EAR_INDICES: Final[tuple[int, int, int, int, int, int]] = (33, 160, 158, 133, 153, 144)
#: Six points (p1..p6) feeding the right Eye Aspect Ratio.
RIGHT_EAR_INDICES: Final[tuple[int, int, int, int, int, int]] = (362, 385, 387, 263, 373, 380)

#: Outer eye corners used to measure the inter-ocular reference distance.
LEFT_EYE_OUTER: Final[int] = 33
RIGHT_EYE_OUTER: Final[int] = 263

#: Column order of the per-frame CSV produced by :class:`EyeFeatureExtractor`.
FRAME_COLUMNS: Final[tuple[str, ...]] = (
    "frame_index",
    "timestamp",
    "face_detected",
    "left_eye_x",
    "left_eye_y",
    "right_eye_x",
    "right_eye_y",
    "gaze_x",
    "gaze_y",
    "eye_distance",
    "left_ear",
    "right_ear",
    "ear",
    "velocity",
    "acceleration",
    "is_blink",
    "is_fixation",
    "is_saccade",
)


@dataclass(slots=True)
class VideoMetadata:
    """Technical description of a decoded video.

    Attributes:
        path: Absolute path of the source video.
        width: Frame width in pixels.
        height: Frame height in pixels.
        fps: Effective frames per second used for the timestamps.
        frame_count: Number of frames actually processed.
        duration: Processed duration in seconds.
        detected_frames: Number of frames where a face was found.
    """

    path: Path
    width: int
    height: int
    fps: float
    frame_count: int
    duration: float
    detected_frames: int

    @property
    def detection_ratio(self) -> float:
        """Fraction of processed frames in which a face was detected."""
        return utils.safe_divide(self.detected_frames, self.frame_count, 0.0)

    def to_dict(self) -> dict[str, Any]:
        """Serialise the metadata into a JSON friendly mapping.

        Returns:
            dict[str, Any]: Plain mapping suitable for API responses.
        """
        return {
            "filename": self.path.name,
            "width": self.width,
            "height": self.height,
            "fps": round(self.fps, 4),
            "frame_count": self.frame_count,
            "duration": round(self.duration, 4),
            "detected_frames": self.detected_frames,
            "detection_ratio": round(self.detection_ratio, 4),
        }


@dataclass(slots=True)
class ExtractionResult:
    """Output of the landmark extraction stage.

    Attributes:
        frames: Per-frame signal table (see :data:`FRAME_COLUMNS`).
        metadata: Technical description of the processed video.
        csv_path: Location of the persisted per-frame CSV, when written.
        blink_count: Number of detected blinks.
        saccade_count: Number of detected saccades.
    """

    frames: pd.DataFrame
    metadata: VideoMetadata
    csv_path: Path | None = None
    blink_count: int = 0
    saccade_count: int = 0
    warnings: list[str] = field(default_factory=list)


class EyeFeatureExtractor:
    """Extract per-frame eye-tracking signals from a video file.

    The MediaPipe FaceMesh graph is created lazily and reused across calls, which
    avoids paying the (expensive) graph construction cost on every request.

    Attributes:
        settings: Application settings driving thresholds and MediaPipe options.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        """Create an extractor bound to a settings object.

        Args:
            settings: Settings instance; the cached global settings are used when
                omitted.
        """
        self.settings: Settings = settings or get_settings()
        self._face_mesh: Any | None = None

    # ------------------------------------------------------------------ setup --
    def _create_face_mesh(self) -> Any:
        """Instantiate the MediaPipe FaceMesh graph from the configuration.

        Returns:
            Any: A ``mediapipe.solutions.face_mesh.FaceMesh`` instance.

        Raises:
            VideoProcessingError: When MediaPipe is not installed.
        """
        try:
            import mediapipe as mp
        except ImportError as exc:  # pragma: no cover - depends on environment
            raise VideoProcessingError(
                "MediaPipe is not installed; run `pip install -r requirements.txt`."
            ) from exc

        settings = self.settings
        return mp.solutions.face_mesh.FaceMesh(
            static_image_mode=settings.face_mesh_static_mode,
            max_num_faces=settings.face_mesh_max_faces,
            refine_landmarks=settings.face_mesh_refine_landmarks,
            min_detection_confidence=settings.face_mesh_min_detection_confidence,
            min_tracking_confidence=settings.face_mesh_min_tracking_confidence,
        )

    @property
    def face_mesh(self) -> Any:
        """Lazily created, reusable FaceMesh instance."""
        if self._face_mesh is None:
            logger.debug("Initialising MediaPipe FaceMesh graph")
            self._face_mesh = self._create_face_mesh()
        return self._face_mesh

    def close(self) -> None:
        """Release the MediaPipe graph and its native resources.

        Returns:
            None
        """
        if self._face_mesh is not None:
            try:
                self._face_mesh.close()
            except Exception:  # pragma: no cover - best effort cleanup
                logger.warning("Failed to close FaceMesh cleanly", exc_info=True)
            finally:
                self._face_mesh = None

    def __enter__(self) -> "EyeFeatureExtractor":
        """Enter the context manager.

        Returns:
            EyeFeatureExtractor: This extractor.
        """
        return self

    def __exit__(self, *exc_info: object) -> None:
        """Exit the context manager and release native resources.

        Args:
            *exc_info: Standard exception triple, ignored.

        Returns:
            None
        """
        self.close()

    # ------------------------------------------------------------ validation --
    def validate_video(self, video_path: Path) -> None:
        """Validate that a file exists, is non-empty and has a supported suffix.

        Args:
            video_path: Path of the video to validate.

        Raises:
            InvalidVideoError: When the file is missing, empty, oversized or has
                an unsupported extension.
        """
        settings = self.settings
        if not video_path.exists() or not video_path.is_file():
            raise InvalidVideoError(f"Video file not found: {video_path.name}")

        size = video_path.stat().st_size
        if size == 0:
            raise InvalidVideoError(f"Video file is empty: {video_path.name}")
        if size > settings.max_upload_size_bytes:
            raise InvalidVideoError(
                f"Video exceeds the {settings.max_upload_size_mb:.0f} MB limit",
                details={"size_bytes": size, "limit_bytes": settings.max_upload_size_bytes},
            )

        suffix = video_path.suffix.lower()
        if suffix not in settings.allowed_video_extensions:
            raise InvalidVideoError(
                f"Unsupported video extension '{suffix}'",
                details={"allowed": settings.allowed_video_extensions},
            )

    # ------------------------------------------------------- landmark helpers --
    @staticmethod
    def _landmark_array(landmarks: Any, width: int, height: int) -> np.ndarray:
        """Convert MediaPipe landmarks into a pixel-space ``(n, 2)`` array.

        Args:
            landmarks: MediaPipe ``NormalizedLandmarkList``.
            width: Frame width in pixels.
            height: Frame height in pixels.

        Returns:
            numpy.ndarray: ``(n, 2)`` array of ``(x, y)`` pixel coordinates.
        """
        points = landmarks.landmark
        array = np.empty((len(points), 2), dtype=float)
        for index, point in enumerate(points):
            array[index, 0] = point.x * width
            array[index, 1] = point.y * height
        return array

    @staticmethod
    def _centroid(points: np.ndarray, indices: Sequence[int]) -> np.ndarray:
        """Return the centroid of the selected landmark indices.

        Args:
            points: ``(n, 2)`` landmark array.
            indices: Landmark indices to average.

        Returns:
            numpy.ndarray: ``(2,)`` centroid; ``[nan, nan]`` when unavailable.
        """
        usable = [i for i in indices if i < points.shape[0]]
        if not usable:
            return np.array([np.nan, np.nan], dtype=float)
        return points[usable].mean(axis=0)

    @staticmethod
    def _eye_aspect_ratio(points: np.ndarray, indices: Sequence[int]) -> float:
        """Compute the Eye Aspect Ratio (EAR) for one eye.

        EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|); it collapses towards zero
        while the eyelid is closed, which is what the blink detector keys on.

        Args:
            points: ``(n, 2)`` landmark array.
            indices: Six landmark indices ordered ``p1..p6``.

        Returns:
            float: EAR value, ``0.0`` when the landmarks are unavailable.
        """
        if max(indices) >= points.shape[0]:
            return 0.0
        p1, p2, p3, p4, p5, p6 = (points[i] for i in indices)
        vertical = utils.euclidean_distance(p2, p6) + utils.euclidean_distance(p3, p5)
        horizontal = utils.euclidean_distance(p1, p4)
        return utils.safe_divide(vertical, 2.0 * horizontal, 0.0)

    def _extract_frame_record(
        self,
        landmarks: Any,
        width: int,
        height: int,
    ) -> dict[str, float]:
        """Turn one FaceMesh detection into a raw per-frame record.

        Args:
            landmarks: MediaPipe ``NormalizedLandmarkList`` for the detected face.
            width: Frame width in pixels.
            height: Frame height in pixels.

        Returns:
            dict[str, float]: Raw (pixel-space) measurements for the frame.
        """
        points = self._landmark_array(landmarks, width, height)
        refined = points.shape[0] > max(RIGHT_IRIS_INDICES)

        left_center = (
            self._centroid(points, LEFT_IRIS_INDICES)
            if refined
            else self._centroid(points, LEFT_EYE_CONTOUR)
        )
        right_center = (
            self._centroid(points, RIGHT_IRIS_INDICES)
            if refined
            else self._centroid(points, RIGHT_EYE_CONTOUR)
        )

        inter_ocular = utils.euclidean_distance(
            points[LEFT_EYE_OUTER], points[RIGHT_EYE_OUTER]
        )
        left_ear = self._eye_aspect_ratio(points, LEFT_EAR_INDICES)
        right_ear = self._eye_aspect_ratio(points, RIGHT_EAR_INDICES)

        return {
            "left_eye_x": float(left_center[0]),
            "left_eye_y": float(left_center[1]),
            "right_eye_x": float(right_center[0]),
            "right_eye_y": float(right_center[1]),
            "eye_distance_px": inter_ocular,
            "left_ear": left_ear,
            "right_ear": right_ear,
            "ear": 0.5 * (left_ear + right_ear),
        }

    # ------------------------------------------------------------ main entry --
    def extract(
        self,
        video_path: Path,
        *,
        output_csv_path: Path | None = None,
        persist_csv: bool = True,
    ) -> ExtractionResult:
        """Extract per-frame eye-tracking signals from a video.

        Args:
            video_path: Path of the video to analyse.
            output_csv_path: Explicit destination of the per-frame CSV.  When
                omitted the file is written next to the video using the
                configured ``frame_csv_suffix``.
            persist_csv: Set to ``False`` to skip writing the CSV entirely.

        Returns:
            ExtractionResult: Per-frame table plus video metadata and event counts.

        Raises:
            InvalidVideoError: When the file cannot be accepted.
            VideoProcessingError: When OpenCV cannot decode the video.
            NoFaceDetectedError: When too few frames contain a detectable face.
        """
        import cv2  # Imported lazily so importing this module stays cheap.

        settings = self.settings
        video_path = Path(video_path).expanduser().resolve()
        self.validate_video(video_path)

        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            capture.release()
            raise VideoProcessingError(f"OpenCV could not open the video: {video_path.name}")

        try:
            fps = utils.to_float(capture.get(cv2.CAP_PROP_FPS), 0.0)
            if fps <= 1.0 or fps > 240.0:
                logger.warning(
                    "Unusable FPS metadata (%.3f) in %s, falling back to %.1f",
                    fps,
                    video_path.name,
                    settings.default_fps,
                )
                fps = settings.default_fps

            records: list[dict[str, float]] = []
            frame_index = 0
            detected = 0
            width = height = 0

            while frame_index < settings.max_frames:
                ok, frame = capture.read()
                if not ok or frame is None:
                    break

                if settings.frame_resize_width > 0 and frame.shape[1] > settings.frame_resize_width:
                    scale = settings.frame_resize_width / float(frame.shape[1])
                    frame = cv2.resize(
                        frame,
                        (settings.frame_resize_width, max(1, int(round(frame.shape[0] * scale)))),
                        interpolation=cv2.INTER_AREA,
                    )

                height, width = frame.shape[:2]
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                rgb.flags.writeable = False
                result = self.face_mesh.process(rgb)

                record: dict[str, float] = {
                    "frame_index": float(frame_index),
                    "timestamp": frame_index / fps,
                    "face_detected": 0.0,
                    "left_eye_x": np.nan,
                    "left_eye_y": np.nan,
                    "right_eye_x": np.nan,
                    "right_eye_y": np.nan,
                    "eye_distance_px": np.nan,
                    "left_ear": np.nan,
                    "right_ear": np.nan,
                    "ear": np.nan,
                }

                if result.multi_face_landmarks:
                    record.update(
                        self._extract_frame_record(result.multi_face_landmarks[0], width, height)
                    )
                    record["face_detected"] = 1.0
                    detected += 1

                records.append(record)
                frame_index += 1
        finally:
            capture.release()

        if not records:
            raise VideoProcessingError(
                f"No frame could be decoded from {video_path.name}",
            )

        metadata = VideoMetadata(
            path=video_path,
            width=width,
            height=height,
            fps=fps,
            frame_count=len(records),
            duration=len(records) / fps,
            detected_frames=detected,
        )

        if metadata.detection_ratio < settings.min_valid_frame_ratio or detected < 5:
            raise NoFaceDetectedError(
                "A face could not be detected in enough frames; ask the user to "
                "re-record with better lighting and the face fully visible.",
                details={
                    "detected_frames": detected,
                    "frame_count": metadata.frame_count,
                    "required_ratio": settings.min_valid_frame_ratio,
                },
            )

        frames = self._build_frame_table(pd.DataFrame.from_records(records), metadata)
        blink_count = utils.count_runs(
            frames["is_blink"].to_numpy(dtype=bool), settings.blink_min_frames
        )
        saccade_count = utils.count_runs(frames["is_saccade"].to_numpy(dtype=bool), 1)

        csv_path: Path | None = None
        if persist_csv:
            csv_path = output_csv_path or self.default_csv_path(video_path)
            self.write_frames_csv(frames, csv_path)

        logger.info(
            "Extracted %d frames from %s (detection=%.1f%%, blinks=%d, saccades=%d)",
            metadata.frame_count,
            video_path.name,
            metadata.detection_ratio * 100.0,
            blink_count,
            saccade_count,
        )

        return ExtractionResult(
            frames=frames,
            metadata=metadata,
            csv_path=csv_path,
            blink_count=blink_count,
            saccade_count=saccade_count,
        )

    # ------------------------------------------------------ signal pipeline --
    def _build_frame_table(self, raw: pd.DataFrame, metadata: VideoMetadata) -> pd.DataFrame:
        """Derive the normalised gaze signals from the raw landmark table.

        Coordinates are expressed in *eye units*: pixel offsets divided by the
        median inter-ocular distance.  This makes every downstream feature
        invariant to the distance between the user and the phone.

        Args:
            raw: Raw per-frame landmark measurements.
            metadata: Metadata of the processed video.

        Returns:
            pandas.DataFrame: Table with the columns of :data:`FRAME_COLUMNS`.
        """
        settings = self.settings
        valid = raw["face_detected"].to_numpy(dtype=float) > 0.5
        timestamps = raw["timestamp"].to_numpy(dtype=float)

        eye_distance_px = utils.interpolate_missing(
            raw["eye_distance_px"].to_numpy(dtype=float), valid
        )
        reference = float(np.median(eye_distance_px[eye_distance_px > 0])) if valid.any() else 0.0
        if reference <= 1e-6:
            reference = 1.0

        columns: dict[str, np.ndarray] = {}
        for name in ("left_eye_x", "left_eye_y", "right_eye_x", "right_eye_y"):
            filled = utils.interpolate_missing(raw[name].to_numpy(dtype=float), valid)
            columns[name] = filled / reference

        gaze_x = utils.smooth_signal(
            0.5 * (columns["left_eye_x"] + columns["right_eye_x"]),
            settings.smoothing_window,
            settings.smoothing_polyorder,
        )
        gaze_y = utils.smooth_signal(
            0.5 * (columns["left_eye_y"] + columns["right_eye_y"]),
            settings.smoothing_window,
            settings.smoothing_polyorder,
        )

        velocity_x = utils.derivative(gaze_x, timestamps)
        velocity_y = utils.derivative(gaze_y, timestamps)
        speed = np.hypot(velocity_x, velocity_y)
        acceleration = utils.derivative(speed, timestamps)

        ear = utils.interpolate_missing(raw["ear"].to_numpy(dtype=float), valid)
        blink_raw = (ear < settings.blink_ear_threshold) | (~valid)
        is_blink = utils.run_mask(blink_raw, settings.blink_min_frames)
        is_saccade = (speed > settings.saccade_velocity_threshold) & (~is_blink)
        is_fixation = utils.run_mask(
            (speed < settings.fixation_velocity_threshold) & (~is_blink),
            settings.fixation_min_frames,
        )

        frames = pd.DataFrame(
            {
                "frame_index": raw["frame_index"].to_numpy(dtype=int),
                "timestamp": timestamps,
                "face_detected": valid.astype(int),
                "left_eye_x": columns["left_eye_x"],
                "left_eye_y": columns["left_eye_y"],
                "right_eye_x": columns["right_eye_x"],
                "right_eye_y": columns["right_eye_y"],
                "gaze_x": gaze_x,
                "gaze_y": gaze_y,
                "eye_distance": eye_distance_px / max(metadata.width, 1),
                "left_ear": utils.interpolate_missing(
                    raw["left_ear"].to_numpy(dtype=float), valid
                ),
                "right_ear": utils.interpolate_missing(
                    raw["right_ear"].to_numpy(dtype=float), valid
                ),
                "ear": ear,
                "velocity": speed,
                "acceleration": acceleration,
                "is_blink": is_blink.astype(int),
                "is_fixation": is_fixation.astype(int),
                "is_saccade": is_saccade.astype(int),
            }
        )
        return frames[list(FRAME_COLUMNS)]

    # ------------------------------------------------------------- csv output --
    def default_csv_path(self, video_path: Path) -> Path:
        """Return the conventional per-frame CSV path for a video.

        Args:
            video_path: Path of the analysed video.

        Returns:
            Path: ``<upload_dir>/<video stem><frame_csv_suffix>``.
        """
        directory = utils.ensure_directory(self.settings.upload_dir)
        return directory / f"{video_path.stem}{self.settings.frame_csv_suffix}"

    @staticmethod
    def write_frames_csv(frames: pd.DataFrame, csv_path: Path) -> Path:
        """Persist the per-frame table to disk.

        Args:
            frames: Per-frame signal table.
            csv_path: Destination CSV path.

        Returns:
            Path: The path that was written.
        """
        utils.ensure_directory(csv_path.parent)
        frames.to_csv(csv_path, index=False)
        logger.debug("Wrote per-frame CSV: %s (%d rows)", csv_path, len(frames))
        return csv_path


def extract_features_from_video(
    video_path: Path,
    *,
    settings: Settings | None = None,
    output_csv_path: Path | None = None,
    persist_csv: bool = True,
) -> ExtractionResult:
    """Convenience wrapper that extracts signals with a short-lived extractor.

    Args:
        video_path: Path of the video to analyse.
        settings: Optional settings override.
        output_csv_path: Explicit destination for the per-frame CSV.
        persist_csv: Set to ``False`` to skip writing the CSV.

    Returns:
        ExtractionResult: Per-frame table plus metadata and event counts.
    """
    with EyeFeatureExtractor(settings=settings) as extractor:
        return extractor.extract(
            video_path,
            output_csv_path=output_csv_path,
            persist_csv=persist_csv,
        )
