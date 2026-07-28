"""Generate a synthetic ``dataset.csv`` so the pipeline can be exercised end to end.

The prototype needs a trained artefact before ``POST /api/predict`` can answer.
Collecting real recordings takes time, so this script samples plausible feature
distributions for a control group and an at-risk group, using effect directions
reported in the smooth-pursuit / antisaccade literature (slower and less smooth
pursuit, larger tracking error and more frequent saccadic intrusions in the
at-risk group).

The output is **synthetic** and must never be used to draw clinical conclusions;
it exists purely so the software can be run, demonstrated and load-tested before
real data is available.

Usage::

    python scripts/generate_synthetic_dataset.py --samples 200 --seed 42
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

# Allow ``python scripts/generate_synthetic_dataset.py`` from the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.ai.feature_engineering import METADATA_COLUMNS  # noqa: E402
from app.ai.utils import ensure_directory, utc_now_iso  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.logging_config import get_logger  # noqa: E402

logger = get_logger(__name__)

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


def build_samples(n_samples: int, positive_ratio: float, seed: int) -> pd.DataFrame:
    """Sample a synthetic dataset from the per-class feature distributions.

    Args:
        n_samples: Total number of rows to generate.
        positive_ratio: Share of rows labelled as at-risk (class ``1``).
        seed: Seed of the random number generator, for reproducibility.

    Returns:
        pandas.DataFrame: Dataset with the metadata, feature and label columns.
    """
    settings = get_settings()
    rng = np.random.default_rng(seed)

    n_positive = int(round(n_samples * positive_ratio))
    labels = np.concatenate([np.ones(n_positive, dtype=int), np.zeros(n_samples - n_positive, dtype=int)])
    rng.shuffle(labels)

    rows: list[dict[str, Any]] = []
    for index, label in enumerate(labels):
        duration = float(rng.uniform(18.0, 32.0))
        fps = float(rng.choice([24.0, 25.0, 30.0]))

        row: dict[str, Any] = {
            "sample_id": f"synthetic_{index:05d}",
            "created_at": utc_now_iso(),
            "filename": f"synthetic_{index:05d}.mp4",
            "subject_id": f"subject_{index % max(1, n_samples // 3):04d}",
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
        row[settings.label_column] = int(label)
        rows.append(row)

    columns = [*METADATA_COLUMNS, *settings.feature_columns, settings.label_column]
    return pd.DataFrame(rows, columns=columns)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the command line arguments.

    Args:
        argv: Argument list; ``sys.argv[1:]`` is used when omitted.

    Returns:
        argparse.Namespace: Parsed options.
    """
    parser = argparse.ArgumentParser(description=__doc__.split("\n", maxsplit=1)[0])
    parser.add_argument("--samples", type=int, default=200, help="Number of rows to generate.")
    parser.add_argument(
        "--positive-ratio", type=float, default=0.5, help="Share of at-risk rows in [0, 1]."
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed.")
    parser.add_argument(
        "--output", type=Path, default=None, help="Destination CSV (defaults to dataset.csv)."
    )
    parser.add_argument(
        "--append", action="store_true", help="Append to the destination instead of replacing it."
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Entry point of the script.

    Args:
        argv: Argument list; ``sys.argv[1:]`` is used when omitted.

    Returns:
        int: Process exit code (``0`` on success).
    """
    args = parse_args(argv)
    if args.samples < 4:
        logger.error("At least 4 samples are required to train a model.")
        return 2
    if not 0.0 < args.positive_ratio < 1.0:
        logger.error("--positive-ratio must lie strictly between 0 and 1.")
        return 2

    settings = get_settings()
    output = Path(args.output) if args.output else settings.dataset_path
    ensure_directory(output.parent)

    frame = build_samples(args.samples, args.positive_ratio, args.seed)
    header = not (args.append and output.exists() and output.stat().st_size > 0)
    frame.to_csv(output, mode="a" if args.append else "w", header=header, index=False)

    counts = frame[settings.label_column].value_counts().sort_index().to_dict()
    logger.info("Wrote %d synthetic samples to %s (label counts: %s)", len(frame), output, counts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
