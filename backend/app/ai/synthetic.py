"""Synthetic sample generation for demos, load tests and smoke runs.

The pipeline needs a trained artefact before ``POST /api/predict`` can answer,
and collecting real recordings takes weeks.  This module samples plausible
feature distributions for a control group and an at-risk group using effect
directions reported in the smooth-pursuit / antisaccade literature: slower and
less smooth pursuit, larger tracking error and more frequent saccadic
intrusions in the at-risk group.

Every row it produces is **fabricated**.  A model trained on this data has no
clinical meaning whatsoever — it exists so the software can be run and
demonstrated before real data is available.  Rows are marked as synthetic in
their ``sample_id`` and ``filename`` so they can always be told apart from real
recordings inside ``dataset.csv``.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.ai.feature_engineering import METADATA_COLUMNS
from app.config import Settings, get_settings

#: Prefix stamped on every generated ``sample_id``, so synthetic rows stay
#: identifiable after they have been appended to a real dataset.
SYNTHETIC_PREFIX = "synthetic"

#: Per-class ``(mean, standard deviation)`` of every feature.
FEATURE_DISTRIBUTIONS: dict[str, dict[int, tuple[float, float]]] = {
    "eye_velocity": {0: (0.42, 0.09), 1: (0.30, 0.09)},
    "eye_acceleration": {0: (2.10, 0.45), 1: (2.85, 0.60)},
    "eye_distance": {0: (0.34, 0.04), 1: (0.34, 0.04)},
    "movement_smoothness": {0: (-4.20, 0.80), 1: (-6.10, 1.00)},
    "blink_rate": {0: (16.0, 4.0), 1: (23.0, 6.0)},
    "fixation_time": {0: (11.5, 2.5), 1: (7.8, 2.6)},
    "total_distance": {0: (9.8, 2.0), 1: (12.6, 3.0)},
    "average_velocity": {0: (0.39, 0.08), 1: (0.50, 0.12)},
    "max_velocity": {0: (2.30, 0.55), 1: (3.20, 0.85)},
    "tracking_error": {0: (0.055, 0.015), 1: (0.105, 0.030)},
}

#: Features that cannot be negative in a real recording.
NON_NEGATIVE_FEATURES: frozenset[str] = frozenset(
    {
        "eye_velocity",
        "eye_acceleration",
        "eye_distance",
        "blink_rate",
        "fixation_time",
        "total_distance",
        "average_velocity",
        "max_velocity",
        "tracking_error",
    }
)

#: Smallest dataset that can still be split into a train and a test part that
#: each contain both classes.
MIN_SAMPLES = 4


def build_samples(
    n_samples: int,
    positive_ratio: float = 0.5,
    seed: int | None = 42,
    *,
    settings: Settings | None = None,
    start_index: int = 0,
    created_at: str | None = None,
) -> pd.DataFrame:
    """Sample a synthetic dataset from the per-class feature distributions.

    Args:
        n_samples: Total number of rows to generate.
        positive_ratio: Share of rows labelled as at-risk (class ``1``).
        seed: Seed of the random number generator; ``None`` draws from entropy,
            which is what repeated "add more mock data" clicks want.
        settings: Settings instance; the cached global settings are used when
            omitted.
        start_index: Offset applied to the generated sample ids, so appending a
            second batch does not reuse the ids of the first.
        created_at: ISO timestamp stamped on every row; the current time is
            used when omitted.

    Returns:
        pandas.DataFrame: Dataset with the metadata, feature and label columns,
        in the exact column order :class:`DatasetRepository` expects.

    Raises:
        ValueError: When ``n_samples`` is below :data:`MIN_SAMPLES` or
            ``positive_ratio`` does not lie strictly between 0 and 1.
    """
    if n_samples < MIN_SAMPLES:
        raise ValueError(f"At least {MIN_SAMPLES} samples are required to train a model.")
    if not 0.0 < positive_ratio < 1.0:
        raise ValueError("positive_ratio must lie strictly between 0 and 1.")

    # Imported lazily so this module stays importable from the standalone
    # script without dragging in the whole application package eagerly.
    from app.ai.utils import utc_now_iso

    resolved = settings or get_settings()
    rng = np.random.default_rng(seed)
    timestamp = created_at or utc_now_iso()

    n_positive = int(round(n_samples * positive_ratio))
    # Guarantee both classes are present even at the extremes of the ratio,
    # otherwise a "balanced enough" looking request can yield an untrainable
    # single-class dataset.
    n_positive = min(max(n_positive, 1), n_samples - 1)
    labels = np.concatenate(
        [np.ones(n_positive, dtype=int), np.zeros(n_samples - n_positive, dtype=int)]
    )
    rng.shuffle(labels)

    rows: list[dict[str, Any]] = []
    for offset, label in enumerate(labels):
        index = start_index + offset
        duration = float(rng.uniform(18.0, 32.0))
        fps = float(rng.choice([24.0, 25.0, 30.0]))

        row: dict[str, Any] = {
            "sample_id": f"{SYNTHETIC_PREFIX}_{index:05d}",
            "created_at": timestamp,
            "filename": f"{SYNTHETIC_PREFIX}_{index:05d}.mp4",
            "subject_id": f"subject_{index % max(1, n_samples // 3):04d}",
            # Older on average in the at-risk group, as in any real cohort that
            # was not age-matched. Present so the report's age filter has
            # something to work on; never fed to the model.
            "age": int(np.clip(rng.normal(68.0 if label else 61.0, 9.0), 40, 95)),
            "duration": round(duration, 4),
            "frame_count": int(duration * fps),
            "fps": fps,
            "detection_ratio": round(float(rng.uniform(0.88, 1.0)), 4),
            "tracking_error_source": "target",
        }

        for feature, distributions in FEATURE_DISTRIBUTIONS.items():
            mean, deviation = distributions[int(label)]
            value = float(rng.normal(mean, deviation))
            if feature in NON_NEGATIVE_FEATURES:
                value = max(value, 1e-4)
            row[feature] = round(value, 6)

        # Keep the derived columns coherent with the sampled features.
        row["fixation_time"] = round(min(row["fixation_time"], duration * 0.9), 6)
        row["max_velocity"] = round(max(row["max_velocity"], row["eye_velocity"] * 2.0), 6)
        row["blink_count"] = int(round(row["blink_rate"] * duration / 60.0))
        row["saccade_count"] = max(0, int(round(rng.normal(14.0 if label == 0 else 24.0, 4.0))))
        row["fixation_ratio"] = round(row["fixation_time"] / duration, 4)
        row["saccade_ratio"] = round(float(rng.uniform(0.04, 0.22)), 4)
        row["velocity_std"] = round(float(rng.uniform(0.15, 0.65)), 6)
        row[resolved.label_column] = int(label)
        rows.append(row)

    columns = [*METADATA_COLUMNS, *resolved.feature_columns, resolved.label_column]
    return pd.DataFrame(rows, columns=columns)


__all__ = [
    "FEATURE_DISTRIBUTIONS",
    "MIN_SAMPLES",
    "NON_NEGATIVE_FEATURES",
    "SYNTHETIC_PREFIX",
    "build_samples",
]
