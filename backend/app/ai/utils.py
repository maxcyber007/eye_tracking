"""Pure, dependency-light helpers shared by the AI modules.

Every function here is deterministic and side-effect free (except the explicit
filesystem helpers), which keeps the signal-processing logic unit-testable in
isolation from OpenCV, MediaPipe and FastAPI.
"""

from __future__ import annotations

import math
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np

_UNSAFE_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")

# ``numpy.trapz`` was renamed to ``numpy.trapezoid`` in NumPy 2.0.
_TRAPEZOID = getattr(np, "trapezoid", None) or np.trapz  # type: ignore[attr-defined]


# --------------------------------------------------------------------------- #
# Filesystem helpers                                                          #
# --------------------------------------------------------------------------- #
def ensure_directory(path: Path) -> Path:
    """Create ``path`` (and its parents) when missing and return it.

    Args:
        path: Directory to create.

    Returns:
        Path: The same directory, guaranteed to exist.
    """
    path.mkdir(parents=True, exist_ok=True)
    return path


def sanitize_filename(filename: str, *, fallback: str = "video") -> str:
    """Strip directories and unsafe characters from a user supplied filename.

    Args:
        filename: Raw filename received from the client.
        fallback: Stem used when nothing usable remains after sanitising.

    Returns:
        str: A filesystem-safe filename.
    """
    name = Path(filename or "").name
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    name = _UNSAFE_FILENAME_CHARS.sub("_", name).strip("._")
    if not name or name.startswith("."):
        name = fallback
    return name[:120]


def build_unique_filename(original_filename: str, *, prefix: str = "") -> str:
    """Build a collision-free filename that keeps the original extension.

    Args:
        original_filename: Filename supplied by the client.
        prefix: Optional prefix inserted before the timestamp.

    Returns:
        str: ``<prefix><timestamp>_<uuid>_<sanitised name>``.
    """
    safe = sanitize_filename(original_filename)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    token = uuid.uuid4().hex[:8]
    return f"{prefix}{stamp}_{token}_{safe}"


def utc_now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string.

    Returns:
        str: Timestamp such as ``2026-07-28T09:15:00+00:00``.
    """
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# Numeric helpers                                                             #
# --------------------------------------------------------------------------- #
def safe_divide(numerator: float, denominator: float, default: float = 0.0) -> float:
    """Divide two numbers, returning ``default`` for degenerate denominators.

    Args:
        numerator: Dividend.
        denominator: Divisor.
        default: Value returned when the divisor is zero or non-finite.

    Returns:
        float: The quotient or ``default``.
    """
    if denominator is None or not math.isfinite(denominator) or abs(denominator) < 1e-12:
        return default
    value = numerator / denominator
    return value if math.isfinite(value) else default


def to_float(value: object, default: float = 0.0) -> float:
    """Coerce an arbitrary value into a finite float.

    Args:
        value: Value to convert.
        default: Fallback used for ``None``, ``NaN``, ``inf`` or bad types.

    Returns:
        float: A finite float.
    """
    try:
        result = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def euclidean_distance(point_a: Sequence[float], point_b: Sequence[float]) -> float:
    """Compute the Euclidean distance between two n-dimensional points.

    Args:
        point_a: First point.
        point_b: Second point.

    Returns:
        float: Distance between the points, ``0.0`` when either is invalid.
    """
    a = np.asarray(point_a, dtype=float)
    b = np.asarray(point_b, dtype=float)
    if a.shape != b.shape or not np.isfinite(a).all() or not np.isfinite(b).all():
        return 0.0
    return float(np.linalg.norm(a - b))


def nan_to_num_array(values: Iterable[float], default: float = 0.0) -> np.ndarray:
    """Convert an iterable into a float array with NaN/inf replaced.

    Args:
        values: Iterable of numbers.
        default: Replacement used for non-finite entries.

    Returns:
        numpy.ndarray: One dimensional float array without NaN or inf.
    """
    array = np.asarray(list(values), dtype=float)
    if array.size == 0:
        return array
    return np.nan_to_num(array, nan=default, posinf=default, neginf=default)


def interpolate_missing(values: np.ndarray, mask_valid: np.ndarray) -> np.ndarray:
    """Linearly interpolate the invalid samples of a 1-D signal.

    Args:
        values: Signal samples.
        mask_valid: Boolean mask, ``True`` where ``values`` is trustworthy.

    Returns:
        numpy.ndarray: Signal where invalid samples were filled by interpolation.
        When no sample is valid an array of zeros is returned.
    """
    values = np.asarray(values, dtype=float)
    mask_valid = np.asarray(mask_valid, dtype=bool)
    if values.size == 0:
        return values
    if not mask_valid.any():
        return np.zeros_like(values)

    indices = np.arange(values.size, dtype=float)
    return np.interp(indices, indices[mask_valid], values[mask_valid])


def moving_average(values: np.ndarray, window: int) -> np.ndarray:
    """Smooth a 1-D signal with a centred moving average.

    Args:
        values: Signal samples.
        window: Window length in samples; values below 2 disable smoothing.

    Returns:
        numpy.ndarray: Smoothed signal with the same length as ``values``.
    """
    values = np.asarray(values, dtype=float)
    if values.size == 0 or window < 2:
        return values
    window = int(min(window, values.size))
    if window % 2 == 0:
        window += 1
    if window > values.size:
        window = values.size if values.size % 2 == 1 else values.size - 1
    if window < 2:
        return values
    kernel = np.ones(window, dtype=float) / float(window)
    padded = np.pad(values, (window // 2, window // 2), mode="edge")
    return np.convolve(padded, kernel, mode="valid")[: values.size]


def smooth_signal(values: np.ndarray, window: int, polyorder: int) -> np.ndarray:
    """Apply a Savitzky-Golay filter, falling back to a moving average.

    Args:
        values: Signal samples.
        window: Filter window length in samples.
        polyorder: Polynomial order of the Savitzky-Golay filter.

    Returns:
        numpy.ndarray: Smoothed signal with the same length as ``values``.
    """
    values = np.asarray(values, dtype=float)
    if values.size < 3 or window < 3:
        return values

    window = int(min(window, values.size))
    if window % 2 == 0:
        window -= 1
    if window <= polyorder or window < 3:
        return moving_average(values, window)

    try:  # SciPy ships with scikit-learn, but the fallback keeps this optional.
        from scipy.signal import savgol_filter

        return np.asarray(savgol_filter(values, window_length=window, polyorder=polyorder))
    except Exception:  # pragma: no cover - defensive fallback
        return moving_average(values, window)


def derivative(values: np.ndarray, timestamps: np.ndarray) -> np.ndarray:
    """Differentiate a signal with respect to (possibly irregular) timestamps.

    Args:
        values: Signal samples.
        timestamps: Sample times in seconds, same length as ``values``.

    Returns:
        numpy.ndarray: First derivative, zero-padded to the input length.
    """
    values = np.asarray(values, dtype=float)
    timestamps = np.asarray(timestamps, dtype=float)
    if values.size < 2 or values.size != timestamps.size:
        return np.zeros_like(values)

    dt = np.diff(timestamps)
    dt[dt <= 0] = np.nan
    delta = np.diff(values) / dt
    delta = np.nan_to_num(delta, nan=0.0, posinf=0.0, neginf=0.0)
    return np.concatenate(([delta[0]], delta))


def root_mean_square(values: np.ndarray) -> float:
    """Compute the root mean square of a signal.

    Args:
        values: Signal samples.

    Returns:
        float: RMS value, ``0.0`` for an empty signal.
    """
    array = nan_to_num_array(np.asarray(values, dtype=float).ravel())
    if array.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(array))))


def log_dimensionless_jerk(
    speed: np.ndarray,
    timestamps: np.ndarray,
    *,
    default: float = 0.0,
) -> float:
    """Compute the log dimensionless jerk (LDLJ) smoothness metric.

    LDLJ is the standard scale-invariant smoothness measure used in motor
    control research; larger (less negative) values indicate smoother motion.

    Args:
        speed: Instantaneous speed samples.
        timestamps: Sample times in seconds.
        default: Value returned when the metric cannot be computed.

    Returns:
        float: The LDLJ value, or ``default`` for degenerate inputs.
    """
    speed = nan_to_num_array(speed)
    timestamps = np.asarray(timestamps, dtype=float)
    if speed.size < 4 or speed.size != timestamps.size:
        return default

    duration = float(timestamps[-1] - timestamps[0])
    peak_speed = float(np.max(np.abs(speed)))
    if duration <= 0.0 or peak_speed <= 1e-9:
        return default

    acceleration = derivative(speed, timestamps)
    jerk = derivative(acceleration, timestamps)
    jerk_energy = float(_TRAPEZOID(np.square(jerk), timestamps))
    if jerk_energy <= 0.0:
        return default

    dimensionless = (duration**3 / peak_speed**2) * jerk_energy
    if dimensionless <= 0.0 or not math.isfinite(dimensionless):
        return default
    value = -math.log(dimensionless)
    return value if math.isfinite(value) else default


def count_runs(mask: np.ndarray, min_length: int = 1) -> int:
    """Count the contiguous ``True`` runs of a boolean mask.

    Args:
        mask: Boolean mask.
        min_length: Minimum number of consecutive ``True`` samples for a run to
            be counted.

    Returns:
        int: Number of qualifying runs.
    """
    mask = np.asarray(mask, dtype=bool)
    if mask.size == 0:
        return 0

    padded = np.concatenate(([False], mask, [False]))
    changes = np.diff(padded.astype(np.int8))
    starts = np.flatnonzero(changes == 1)
    ends = np.flatnonzero(changes == -1)
    lengths = ends - starts
    return int(np.count_nonzero(lengths >= max(1, min_length)))


def run_mask(mask: np.ndarray, min_length: int) -> np.ndarray:
    """Keep only the ``True`` runs that are at least ``min_length`` samples long.

    Args:
        mask: Boolean mask.
        min_length: Minimum run length in samples.

    Returns:
        numpy.ndarray: Filtered boolean mask of the same length.
    """
    mask = np.asarray(mask, dtype=bool)
    if mask.size == 0 or min_length <= 1:
        return mask

    result = np.zeros_like(mask)
    padded = np.concatenate(([False], mask, [False]))
    changes = np.diff(padded.astype(np.int8))
    for start, end in zip(np.flatnonzero(changes == 1), np.flatnonzero(changes == -1)):
        if end - start >= min_length:
            result[start:end] = True
    return result


def affine_residual_rms(source: np.ndarray, target: np.ndarray) -> float:
    """Fit a 2-D affine map from ``source`` to ``target`` and return the residual.

    This performs the implicit gaze-to-screen calibration required to compare a
    raw gaze trajectory with the on-screen stimulus trajectory.

    Args:
        source: ``(n, 2)`` array of gaze coordinates.
        target: ``(n, 2)`` array of stimulus coordinates.

    Returns:
        float: RMS of the residual after the least-squares affine fit.
    """
    source = np.asarray(source, dtype=float)
    target = np.asarray(target, dtype=float)
    if source.ndim != 2 or source.shape != target.shape or source.shape[0] < 3:
        return 0.0

    design = np.hstack([source, np.ones((source.shape[0], 1), dtype=float)])
    try:
        coefficients, *_ = np.linalg.lstsq(design, target, rcond=None)
    except np.linalg.LinAlgError:  # pragma: no cover - numerically degenerate input
        return 0.0

    residual = target - design @ coefficients
    return float(np.sqrt(np.mean(np.sum(np.square(residual), axis=1))))


def normalise_unit_range(values: np.ndarray) -> np.ndarray:
    """Rescale each column of an array into the ``[0, 1]`` range.

    Args:
        values: ``(n, d)`` array.

    Returns:
        numpy.ndarray: Array of the same shape rescaled column-wise.  Constant
        columns are mapped to zeros.
    """
    values = np.asarray(values, dtype=float)
    if values.size == 0:
        return values
    minimum = np.nanmin(values, axis=0)
    maximum = np.nanmax(values, axis=0)
    span = np.where(np.abs(maximum - minimum) < 1e-9, 1.0, maximum - minimum)
    return np.clip((values - minimum) / span, 0.0, 1.0)


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    """Clamp a value into a closed interval.

    Args:
        value: Value to clamp.
        lower: Lower bound.
        upper: Upper bound.

    Returns:
        float: ``value`` constrained to ``[lower, upper]``.
    """
    return float(max(lower, min(upper, to_float(value, lower))))


def classify_risk_level(
    risk_score: float,
    low_threshold: float,
    moderate_threshold: float,
    labels: Sequence[str],
) -> str:
    """Map a continuous risk score onto a discrete risk level label.

    Args:
        risk_score: Continuous score in ``[0, 1]``.
        low_threshold: Upper bound (exclusive) of the ``Low`` band.
        moderate_threshold: Upper bound (exclusive) of the ``Moderate`` band.
        labels: Three ordered labels for the low/moderate/high bands.

    Returns:
        str: The matching risk level label.
    """
    score = clamp(risk_score)
    if score < low_threshold:
        return labels[0]
    if score < moderate_threshold:
        return labels[1]
    return labels[2]
