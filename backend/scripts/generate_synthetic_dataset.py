"""Generate a synthetic ``dataset.csv`` so the pipeline can be exercised end to end.

The prototype needs a trained artefact before ``POST /api/predict`` can answer.
Collecting real recordings takes time, so this script samples plausible feature
distributions for a control group and an at-risk group, using effect directions
reported in the smooth-pursuit / antisaccade literature (slower and less smooth
pursuit, larger tracking error and more frequent saccadic intrusions in the
at-risk group).

The sampling itself lives in :mod:`app.ai.synthetic`, which the ``ตั้งค่า`` page
calls through ``POST /api/dataset/mock``; this script is the command line front
end to the same code, so both routes always produce identical rows.

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

# Allow ``python scripts/generate_synthetic_dataset.py`` from the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.ai.synthetic import MIN_SAMPLES, build_samples  # noqa: E402
from app.ai.utils import ensure_directory  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.logging_config import get_logger  # noqa: E402

logger = get_logger(__name__)


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
    if args.samples < MIN_SAMPLES:
        logger.error("At least %d samples are required to train a model.", MIN_SAMPLES)
        return 2
    if not 0.0 < args.positive_ratio < 1.0:
        logger.error("--positive-ratio must lie strictly between 0 and 1.")
        return 2

    settings = get_settings()
    output = Path(args.output) if args.output else settings.dataset_path
    ensure_directory(output.parent)

    frame = build_samples(args.samples, args.positive_ratio, args.seed, settings=settings)
    header = not (args.append and output.exists() and output.stat().st_size > 0)
    frame.to_csv(output, mode="a" if args.append else "w", header=header, index=False)

    counts = frame[settings.label_column].value_counts().sort_index().to_dict()
    logger.info("Wrote %d synthetic samples to %s (label counts: %s)", len(frame), output, counts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
