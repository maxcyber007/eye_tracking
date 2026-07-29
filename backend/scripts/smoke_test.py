"""End-to-end smoke test of the whole API, without needing a camera.

The script synthesises a short video containing a simple animated face, then
drives the real FastAPI application through the complete workflow::

    health -> train (synthetic dataset) -> upload -> predict -> history

It exercises the success paths *and* the documented failure paths, so a green
run means OpenCV, MediaPipe, scikit-learn, SQLite and every route are wired
together correctly on this machine.

Usage::

    python scripts/smoke_test.py                 # in-process, no server needed
    python scripts/smoke_test.py --keep-artifacts

Exit code is ``0`` when every check passes, ``1`` otherwise.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import cv2
import numpy as np

# Allow ``python scripts/smoke_test.py`` from the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.logging_config import get_logger  # noqa: E402

logger = get_logger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parent.parent

#: Dedicated account created for the run, so the test never needs the real
#: admin password and never leaves a usable login behind.
TEST_USERNAME = "smoketest"
TEST_PASSWORD = "smoke-test-password-9f2a"


class CheckReporter:
    """Collects pass/fail results and prints them as a readable checklist.

    Attributes:
        failures: Number of checks that did not pass.
        total: Number of checks performed.
    """

    def __init__(self) -> None:
        """Create an empty reporter."""
        self.failures: int = 0
        self.total: int = 0

    def check(self, description: str, condition: bool, detail: str = "") -> bool:
        """Record and print the outcome of a single assertion.

        Args:
            description: What was being verified.
            condition: ``True`` when the check passed.
            detail: Extra context appended to the printed line.

        Returns:
            bool: The value of ``condition``, so callers can branch on it.
        """
        self.total += 1
        mark = "PASS" if condition else "FAIL"
        if not condition:
            self.failures += 1
        suffix = f"  ({detail})" if detail else ""
        print(f"  [{mark}] {description}{suffix}")
        return condition

    def summary(self) -> int:
        """Print the final tally.

        Returns:
            int: Process exit code — ``0`` when everything passed.
        """
        passed = self.total - self.failures
        print(f"\n{passed}/{self.total} checks passed")
        return 0 if self.failures == 0 else 1


def draw_face(canvas: np.ndarray, gaze_x: float, gaze_y: float, blink: bool) -> np.ndarray:
    """Draw a schematic but FaceMesh-detectable face onto a frame.

    Args:
        canvas: Destination BGR frame, modified in place.
        gaze_x: Horizontal pupil offset in pixels.
        gaze_y: Vertical pupil offset in pixels.
        blink: Whether the eyelids should be drawn closed.

    Returns:
        numpy.ndarray: The same canvas, for chaining.
    """
    center_x, center_y = canvas.shape[1] // 2, canvas.shape[0] // 2
    cv2.ellipse(canvas, (center_x, center_y), (150, 200), 0, 0, 360, (205, 175, 150), -1)

    for side in (-1, 1):
        eye_x, eye_y = center_x + side * 55, center_y - 40
        cv2.ellipse(canvas, (eye_x, eye_y), (34, 6 if blink else 18), 0, 0, 360, (255, 255, 255), -1)
        if not blink:
            pupil = (int(eye_x + gaze_x), int(eye_y + gaze_y))
            cv2.circle(canvas, pupil, 10, (60, 40, 30), -1)
            cv2.circle(canvas, pupil, 4, (0, 0, 0), -1)
        cv2.ellipse(canvas, (eye_x, eye_y), (36, 20), 0, 180, 360, (120, 90, 70), 2)
        cv2.ellipse(canvas, (eye_x, eye_y - 30), (34, 10), 0, 180, 360, (70, 50, 40), 4)

    cv2.line(canvas, (center_x, center_y - 20), (center_x, center_y + 35), (150, 120, 100), 3)
    cv2.ellipse(canvas, (center_x, center_y + 80), (50, 22), 0, 0, 180, (120, 60, 60), 3)
    return canvas


def synthesise_video(path: Path, *, frames: int = 150, fps: int = 30) -> Path:
    """Render a short synthetic pursuit recording to disk.

    Args:
        path: Destination ``.mp4`` path.
        frames: Number of frames to render.
        fps: Frame rate written into the container.

    Returns:
        Path: The path that was written.
    """
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (640, 480))
    try:
        for index in range(frames):
            canvas = np.full((480, 640, 3), 40, dtype=np.uint8)
            seconds = index / fps
            draw_face(
                canvas,
                gaze_x=12.0 * np.sin(2 * np.pi * 0.4 * seconds),
                gaze_y=6.0 * np.cos(2 * np.pi * 0.4 * seconds),
                blink=(index % 37) in (0, 1, 2),
            )
            writer.write(canvas)
    finally:
        writer.release()
    return path


def synthetic_trajectory(frames: int, fps: int) -> list[dict[str, float]]:
    """Build a stimulus path matching the synthetic recording.

    Args:
        frames: Number of frames in the recording.
        fps: Frame rate of the recording.

    Returns:
        list[dict[str, float]]: Points shaped ``{"t": .., "x": .., "y": ..}``.
    """
    return [
        {
            "t": index / fps,
            "x": float(np.sin(2 * np.pi * 0.4 * index / fps)),
            "y": float(np.cos(2 * np.pi * 0.4 * index / fps)),
        }
        for index in range(frames)
    ]


def check_env_example(reporter: CheckReporter) -> None:
    """Verify that ``.env.example`` actually loads as a settings file.

    This guards a real failure mode: pydantic-settings JSON-decodes complex
    fields inside the settings source, so a friendly value like
    ``CORS_ALLOW_ORIGINS=*`` raises before any validator runs.  Copying the
    example to ``.env`` then breaks start-up, which no other check catches
    because the tests otherwise run on the built-in defaults.

    Args:
        reporter: Collector for the individual check results.

    Returns:
        None
    """
    from pydantic_settings import SettingsConfigDict

    from app.config import Settings

    example = BACKEND_ROOT / ".env.example"
    if not reporter.check(".env.example exists", example.is_file()):
        return

    class ExampleSettings(Settings):
        """Settings bound to ``.env.example`` instead of ``.env``."""

        model_config = SettingsConfigDict(
            env_file=str(example),
            env_file_encoding="utf-8",
            extra="ignore",
            case_sensitive=False,
            protected_namespaces=(),
        )

    try:
        loaded = ExampleSettings()
    except Exception as exc:  # noqa: BLE001 - the point is to report any failure
        reporter.check(".env.example loads without error", False, f"{type(exc).__name__}: {exc}")
        return

    reporter.check(".env.example loads without error", True)
    reporter.check(
        "list settings parse from comma separated values",
        loaded.cors_allow_origins == ["*"] and len(loaded.allowed_video_extensions) >= 4,
        f"origins={loaded.cors_allow_origins}",
    )
    reporter.check(
        "feature columns match the model contract",
        len(loaded.feature_columns) == 10,
        f"{len(loaded.feature_columns)} features",
    )
    reporter.check(
        "model params parse from JSON",
        isinstance(loaded.model_params, dict) and "n_estimators" in loaded.model_params,
    )


def run_checks(client: Any, video: Path, reporter: CheckReporter) -> None:
    """Drive the API through the full workflow and record the outcomes.

    Args:
        client: A ``fastapi.testclient.TestClient`` bound to the application.
        video: Path of the synthetic recording to upload.
        reporter: Collector for the individual check results.

    Returns:
        None
    """
    frames, fps = 150, 30

    print("\n1. Configuration")
    check_env_example(reporter)

    print("\n2. Health endpoints")
    response = client.get("/")
    reporter.check("GET / returns 200", response.status_code == 200)
    response = client.get("/health")
    reporter.check("GET /health returns 200", response.status_code == 200)
    reporter.check("SQLite is reachable", response.json().get("database") is True)

    print("\n3. Authentication")
    settings = get_settings()
    if settings.auth_enabled:
        for method, path in [
            ("GET", "/api/history"),
            ("GET", "/api/train/status"),
            ("POST", "/api/train"),
        ]:
            response = client.request(method, path, json={} if method == "POST" else None)
            reporter.check(
                f"{method} {path} requires a session",
                response.status_code == 401,
                response.json().get("error", ""),
            )

        response = client.post(
            "/api/auth/login", json={"username": TEST_USERNAME, "password": "wrong-password"}
        )
        reporter.check("Login rejects a wrong password", response.status_code == 401)

        response = client.post(
            "/api/auth/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD}
        )
        signed_in = reporter.check(
            "Login succeeds with the correct password", response.status_code == 200
        )
        if not signed_in:
            return
        reporter.check(
            "GET /api/auth/me returns the account",
            client.get("/api/auth/me").status_code == 200,
        )
    else:
        reporter.check("Authentication is disabled by configuration", True, "AUTH_ENABLED=false")

    print("\n4. Failure paths before training")
    response = client.post("/api/train", json={})
    reporter.check(
        "POST /api/train without a dataset returns 400",
        response.status_code == 400,
        response.json().get("error", ""),
    )
    response = client.post("/api/predict", data={"filename": "does-not-exist.mp4"})
    reporter.check(
        "POST /api/predict with an unknown file returns 400",
        response.status_code == 400,
        response.json().get("error", ""),
    )
    response = client.post("/api/upload", files={"file": ("notes.txt", b"hello", "text/plain")})
    reporter.check(
        "POST /api/upload rejects a non-video extension",
        response.status_code == 400,
        response.json().get("error", ""),
    )

    print("\n5. Dataset generation and training")
    generated = subprocess.run(
        [sys.executable, "scripts/generate_synthetic_dataset.py", "--samples", "120", "--seed", "7"],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
    )
    reporter.check(
        "Synthetic dataset generated",
        generated.returncode == 0,
        generated.stderr.strip().splitlines()[-1] if generated.returncode else "",
    )

    response = client.post("/api/train", json={})
    trained = reporter.check("POST /api/train returns 200", response.status_code == 200)
    if trained:
        metrics = response.json()["metrics"]
        reporter.check(
            "Hold-out accuracy is above chance",
            metrics["accuracy"] > 0.5,
            f"accuracy={metrics['accuracy']:.3f} f1={metrics['f1_score']:.3f}",
        )
        reporter.check(
            "The model artefact was written",
            Path(response.json()["model_path"]).exists(),
        )

    print("\n6. Computer-vision pipeline")
    trajectory = json.dumps(synthetic_trajectory(frames, fps))
    with video.open("rb") as handle:
        response = client.post(
            "/api/upload",
            files={"file": ("smoke.mp4", handle, "video/mp4")},
            data={"subject_id": "SMOKE", "label": "0", "target_trajectory": trajectory},
        )
    uploaded = reporter.check(
        "POST /api/upload returns 201",
        response.status_code == 201,
        "" if response.status_code == 201 else json.dumps(response.json())[:200],
    )
    if not uploaded:
        return

    payload = response.json()
    reporter.check(
        "MediaPipe detected a face in most frames",
        payload["video"]["detection_ratio"] > 0.8,
        f"{payload['video']['detection_ratio']:.0%}",
    )
    reporter.check(
        "The per-frame CSV was written",
        payload["frame_csv_path"] is not None and Path(payload["frame_csv_path"]).exists(),
    )
    settings = get_settings()
    reporter.check(
        "All ten features were produced",
        set(payload["features"]) == set(settings.feature_columns),
        f"{len(payload['features'])} features",
    )
    reporter.check(
        "tracking_error used the supplied stimulus path",
        payload["sample_metadata"]["tracking_error_source"] == "target",
    )
    reporter.check("Blinks were detected", payload["blink_count"] > 0, f"{payload['blink_count']}")
    reporter.check(
        "The labelled sample joined the dataset",
        payload["dataset_path"] is not None,
    )
    reporter.check("A prediction was returned", payload.get("prediction") is not None)

    print("\n7. Prediction and history")
    response = client.post("/api/predict", data={"filename": payload["filename"]})
    predicted = reporter.check("POST /api/predict returns 200", response.status_code == 200)
    if predicted:
        body = response.json()
        reporter.check(
            "risk_score lies in [0, 1]",
            0.0 <= body["risk_score"] <= 1.0,
            f"risk_score={body['risk_score']} level={body['risk_level']}",
        )
        reporter.check(
            "risk_level is one of the configured bands",
            body["risk_level"] in settings.risk_level_labels,
        )

    response = client.post(
        "/api/predict/features",
        json={"features": payload["features"], "subject_id": "SMOKE"},
    )
    reporter.check("POST /api/predict/features returns 200", response.status_code == 200)

    response = client.get("/api/history?limit=10")
    reporter.check(
        "GET /api/history lists the stored assessments",
        response.status_code == 200 and response.json()["total"] > 0,
        f"total={response.json().get('total')}",
    )

    print("\n8. OpenAPI document")
    response = client.get("/openapi.json")
    reporter.check("GET /openapi.json returns 200", response.status_code == 200)



def ensure_test_account() -> None:
    """Create the dedicated smoke-test account, replacing any stale one.

    Creating the account directly through the repository keeps the run
    independent of the generated admin password, and the account disappears with
    the database during cleanup.

    Returns:
        None
    """
    from app.auth import UserRepository
    from app.database import get_database

    repository = UserRepository(get_database())
    if repository.get_by_username(TEST_USERNAME) is None:
        repository.create(TEST_USERNAME, TEST_PASSWORD, display_name="Smoke test", role="admin")
    else:
        repository.set_password(TEST_USERNAME, TEST_PASSWORD)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the command line arguments.

    Args:
        argv: Argument list; ``sys.argv[1:]`` is used when omitted.

    Returns:
        argparse.Namespace: Parsed options.
    """
    parser = argparse.ArgumentParser(description=__doc__.split("\n", maxsplit=1)[0])
    parser.add_argument(
        "--keep-artifacts",
        action="store_true",
        help="Keep the generated dataset, model, uploads and database.",
    )
    return parser.parse_args(argv)


def cleanup(paths: list[Path]) -> None:
    """Delete the artefacts produced by the run.

    Args:
        paths: Files to remove; missing entries are ignored.

    Returns:
        None
    """
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:  # pragma: no cover - best effort cleanup
            logger.warning("Could not remove %s", path)


def main(argv: list[str] | None = None) -> int:
    """Entry point of the script.

    Args:
        argv: Argument list; ``sys.argv[1:]`` is used when omitted.

    Returns:
        int: Process exit code (``0`` when every check passed).
    """
    args = parse_args(argv)

    try:
        from fastapi.testclient import TestClient
    except ImportError:
        print("httpx is required: pip install -r requirements.txt")
        return 2

    from app.main import app

    settings = get_settings()
    reporter = CheckReporter()

    print("=" * 68)
    print("Alzheimer Eye-Tracking Risk API - smoke test")
    print("=" * 68)

    with tempfile.TemporaryDirectory() as workspace:
        video = synthesise_video(Path(workspace) / "smoke.mp4")
        print(f"\n0. Synthetic recording: {video.stat().st_size / 1024:.0f} KB")

        with TestClient(app) as client:
            ensure_test_account()
            run_checks(client, video, reporter)

    if not args.keep_artifacts:
        print("\nCleaning up generated artefacts ...")
        cleanup([settings.dataset_path, settings.model_path])
        cleanup(list(settings.upload_dir.glob("*.mp4")))
        cleanup(list(settings.upload_dir.glob("*_output.csv")))
        cleanup(
            [
                settings.database_path,
                settings.database_path.with_suffix(".db-wal"),
                settings.database_path.with_suffix(".db-shm"),
            ]
        )

    return reporter.summary()


if __name__ == "__main__":
    raise SystemExit(main())
