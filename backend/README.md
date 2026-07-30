# MyEye Risk API

Research **prototype** that estimates an early Alzheimer's disease risk score from a
smooth-pursuit eye-tracking task recorded with a smartphone front camera.

> ⚠️ **Not a medical device.** This is research software. The bundled model is trained on
> *synthetic* data so the system can be demonstrated before real recordings exist. Nothing
> it outputs is a diagnosis, and it must not be used for clinical decisions.

---

## Table of contents

- [Workflow](#workflow)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Quick start](#quick-start)
- [REST API](#rest-api)
- [Eye-tracking signals](#eye-tracking-signals)
- [Feature engineering](#feature-engineering)
- [Training](#training)
- [Prediction](#prediction)
- [Database](#database)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Extending the model (LSTM / PyTorch)](#extending-the-model-lstm--pytorch)
- [Frontend integration](#frontend-integration)
- [Troubleshooting](#troubleshooting)

---

## Workflow

```
User opens the frontend
        ↓
Frontend opens the front camera
        ↓
A ball moves across the screen
        ↓
The user follows the ball with their eyes
        ↓
Frontend records the video
        ↓
POST /api/upload  (multipart)
        ↓
OpenCV decodes every frame
        ↓
MediaPipe FaceMesh locates the landmarks
        ↓
Left- and right-eye landmarks are extracted
        ↓
<video>_output.csv   (per-frame signals)
        ↓
Feature engineering
        ↓
dataset.csv          (one row per labelled recording)
        ↓
RandomForestClassifier
        ↓
Risk score
        ↓
{ "risk_score": 0.72, "risk_level": "Moderate" }
```

## Tech stack

| Layer     | Technology                                              |
| --------- | ------------------------------------------------------- |
| Backend   | Python 3.12, FastAPI, Uvicorn, Pydantic v2               |
| AI        | OpenCV, MediaPipe FaceMesh, NumPy, Pandas, scikit-learn, Joblib |
| Database  | SQLite (standard-library `sqlite3`, WAL mode)            |
| Docs      | OpenAPI / Swagger UI at `/docs`, ReDoc at `/redoc`       |

## Project structure

```
backend/
├── app/
│   ├── main.py                 # FastAPI factory, lifespan, exception handlers
│   ├── config.py               # Pydantic settings — every path/threshold lives here
│   ├── logging_config.py       # Central logging setup
│   ├── exceptions.py           # Domain exception hierarchy → HTTP status codes
│   ├── schemas.py              # Pydantic request/response models
│   ├── dependencies.py         # FastAPI dependency providers (DI wiring)
│   ├── database.py             # SQLite repository for `test_history`
│   │
│   ├── api/
│   │   ├── health.py           # GET /  and  GET /health
│   │   ├── upload.py           # POST /api/upload
│   │   ├── train.py            # POST /api/train, GET /api/train/status
│   │   ├── predict.py          # POST /api/predict, /api/predict/features, GET /api/history
│   │   └── maintenance.py      # POST /api/dataset/mock, DELETE /api/dataset, /api/model
│   │
│   ├── ai/
│   │   ├── base.py             # BaseRiskModel ABC + model registry + ModelBundle
│   │   ├── estimators.py       # RandomForest / GradientBoosting implementations
│   │   ├── extract_feature.py  # OpenCV + FaceMesh → per-frame CSV
│   │   ├── feature_engineering.py  # per-frame CSV → 10 features → dataset.csv
│   │   ├── train_model.py      # dataset.csv → myeye_model.pkl (joblib)
│   │   ├── predict_model.py    # cached inference + risk banding
│   │   ├── pipeline.py         # end-to-end orchestration service
│   │   ├── synthetic.py        # fabricated samples for demos and smoke runs
│   │   └── utils.py            # signal processing & filesystem helpers
│   │
│   ├── models/                 # myeye_model.pkl  (generated)
│   └── uploads/                # recordings + *_output.csv  (generated)
│
├── dataset/                    # dataset.csv  (generated)
├── scripts/
│   └── generate_synthetic_dataset.py
├── requirements.txt
├── .env.example
└── README.md
```

## Deployment

For Docker / Portainer, see [DEPLOY.md](../DEPLOY.md). Note that the camera
requires HTTPS: a container published over plain HTTP on anything other than
localhost will serve every page but never open the camera.

## Quick start

```bash
cd backend

# 1) Virtual environment (Python 3.12)
python3.12 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 2) Dependencies
pip install -r requirements.txt

# 3) Configuration (optional — sensible defaults are built in)
cp .env.example .env

# 4) Run
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000/docs> for the Swagger UI.

### Get a working model in 30 seconds

`POST /api/predict` needs a trained artefact. Two ways to get one:

**A. Synthetic bootstrap** — for demos and integration testing:

```bash
python scripts/generate_synthetic_dataset.py --samples 200 --seed 42
curl -X POST http://127.0.0.1:8000/api/train
```

**B. Real recordings** — the research path. Upload labelled recordings until each class has
enough samples, then train:

```bash
curl -X POST http://127.0.0.1:8000/api/upload \
     -F "file=@control_01.mp4" -F "label=0" -F "subject_id=C001"
curl -X POST http://127.0.0.1:8000/api/upload \
     -F "file=@patient_01.mp4" -F "label=1" -F "subject_id=P001"
# ... repeat ...
curl -X POST http://127.0.0.1:8000/api/train
```

Then score a new recording:

```bash
curl -X POST http://127.0.0.1:8000/api/predict -F "file=@new_recording.mp4"
```

```json
{
  "success": true,
  "risk_score": 0.72,
  "risk_level": "Moderate",
  "confidence": 0.72,
  "model_type": "random_forest",
  "history_id": 12
}
```

## REST API

| Method | Path                    | Description                                                        |
| ------ | ----------------------- | ------------------------------------------------------------------ |
| GET    | `/`                     | Liveness probe, or a redirect to the web client.                    |
| GET    | `/health`               | Readiness probe: database, model, dataset and history counters.     |
| POST   | `/api/upload`           | Upload a recording, extract features, optionally label and predict. |
| POST   | `/api/train`            | Train the model from `dataset.csv` and write `myeye_model.pkl`.       |
| GET    | `/api/train/status`     | Inspect the dataset and the currently loaded model.                 |
| POST   | `/api/predict`          | Predict from a new upload or a previously stored filename.          |
| POST   | `/api/predict/features` | Predict directly from a pre-computed feature vector.                |
| GET    | `/api/history`          | Paginated listing of past assessments.                              |
| POST   | `/api/dataset/mock`     | Write fabricated rows into `dataset.csv` for demos and smoke runs.  |
| DELETE | `/api/dataset`          | Delete `dataset.csv`. Needs `?confirm=true`.                        |
| DELETE | `/api/model`            | Delete `myeye_model.pkl` so it can be retrained. Needs `?confirm=true`. |

The last three back the **ตั้งค่า** page. They either destroy data or write rows
that are not measurements, so each one is behind an explicit confirmation, and
every generated row keeps a `synthetic_` sample id that stays visible in the
dataset.

### `POST /api/upload` (multipart/form-data)

| Field               | Type   | Required | Description                                                     |
| ------------------- | ------ | -------- | --------------------------------------------------------------- |
| `file`              | file   | yes      | Front-camera recording (`.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.m4v`). |
| `subject_id`        | string | no       | Participant identifier stored with the sample.                   |
| `label`             | int    | no       | `0` = control, `1` = at risk. **Present ⇒ appended to `dataset.csv`.** |
| `target_trajectory` | string | no       | JSON stimulus path: `[{"t":0.0,"x":0.1,"y":0.5}, ...]`.          |
| `predict`           | bool   | no       | Also run inference (default `true`; skipped if no model exists). |
| `save_history`      | bool   | no       | Persist the prediction into `test_history` (default `true`).     |

### `POST /api/train` (application/json)

Every field is optional; omit the body entirely to use the configured defaults.

```json
{
  "model_type": "random_forest",
  "dataset_path": null,
  "model_path": null,
  "params": { "n_estimators": 500, "max_depth": 12 }
}
```

### Error envelope

Every failure returns the same shape:

```json
{
  "success": false,
  "error": "NoFaceDetectedError",
  "message": "A face could not be detected in enough frames; ...",
  "details": { "detected_frames": 12, "frame_count": 300, "required_ratio": 0.3 }
}
```

| Status | Raised by                                                              |
| ------ | ---------------------------------------------------------------------- |
| 400    | `InvalidVideoError`, `DatasetError`, `ModelRegistryError`               |
| 409    | `ModelNotTrainedError` — call `POST /api/train` first                   |
| 422    | `VideoProcessingError`, `NoFaceDetectedError`, `FeatureExtractionError`, `ModelTrainingError` |
| 500    | `RepositoryError`, `ConfigurationError`, unexpected errors              |

## Eye-tracking signals

MediaPipe FaceMesh runs with `refine_landmarks=True`, which adds the ten iris landmarks
(468–477) on top of the 468-point mesh. Iris centroids give a far better gaze estimate than
eyelid contours; the contours are kept as an automatic fallback.

Every coordinate is converted into **eye units** — pixel offsets divided by the median
inter-ocular distance — so the features do not change when the user holds the phone closer
or further away. Frames without a detection are linearly interpolated, and the gaze signal is
low-pass filtered with a Savitzky-Golay filter before differentiation.

`<video>_output.csv` (written to `app/uploads/`) contains one row per frame:

| Column                                    | Meaning                                        |
| ----------------------------------------- | ---------------------------------------------- |
| `frame_index`, `timestamp`                | Frame number and time in seconds.              |
| `face_detected`                           | `1` when FaceMesh found a face.                |
| `left_eye_x/y`, `right_eye_x/y`           | Per-eye centres in eye units.                  |
| `gaze_x`, `gaze_y`                        | Smoothed binocular gaze centre.                |
| `eye_distance`                            | Inter-ocular distance normalised by frame width. |
| `left_ear`, `right_ear`, `ear`            | Eye Aspect Ratio, the blink signal.            |
| `velocity`, `acceleration`                | First and second derivatives of the gaze path. |
| `is_blink`, `is_fixation`, `is_saccade`   | Per-frame event flags.                         |

Blinks are contiguous runs of `ear < BLINK_EAR_THRESHOLD` lasting at least
`BLINK_MIN_FRAMES`; saccades are runs above `SACCADE_VELOCITY_THRESHOLD`; fixations are runs
below `FIXATION_VELOCITY_THRESHOLD` lasting at least `FIXATION_MIN_FRAMES`.

## Feature engineering

Each recording collapses into the ten features stored in `dataset/dataset.csv`:

| Feature               | Definition                                                            |
| --------------------- | --------------------------------------------------------------------- |
| `eye_velocity`        | Mean gaze speed (eye units/s).                                        |
| `eye_acceleration`    | Mean absolute gaze acceleration.                                      |
| `eye_distance`        | Mean inter-ocular distance, normalised by frame width.                |
| `movement_smoothness` | Log dimensionless jerk (LDLJ); **higher = smoother**, values are negative. |
| `blink_rate`          | Detected blinks per minute.                                           |
| `fixation_time`       | Total time spent in fixation (seconds).                               |
| `total_distance`      | Cumulative gaze path length.                                          |
| `average_velocity`    | `total_distance / duration`.                                          |
| `max_velocity`        | Peak gaze speed.                                                      |
| `tracking_error`      | RMS deviation from the stimulus path (see below).                     |

**`tracking_error` has two modes**, reported in `sample_metadata.tracking_error_source`:

- `"target"` — the frontend supplied `target_trajectory`. A least-squares **affine
  gaze-to-screen calibration** is fitted first (raw gaze and screen coordinates live in
  different frames of reference), and the RMS residual after calibration is reported. This is
  the meaningful measurement and the one you want for research.
- `"self"` — no trajectory was supplied. The RMS deviation between the gaze signal and its own
  low-pass version is reported instead, which captures tracking instability rather than true
  pursuit error. **Send `target_trajectory` whenever you can**; the two modes are not
  comparable, so never mix them inside one dataset.

`dataset.csv` also stores non-predictive metadata (`sample_id`, `filename`, `subject_id`,
`duration`, `fps`, `detection_ratio`, `blink_count`, `saccade_count`, …) so every row remains
traceable back to its recording.

## Training

`POST /api/train`:

1. loads `dataset/dataset.csv` and coerces the feature columns to numeric;
2. splits **80 / 20**, stratified whenever both classes have ≥ 2 samples;
3. fits a `RandomForestClassifier` (`class_weight="balanced"`);
4. evaluates accuracy, weighted precision / recall / F1, ROC AUC, a stratified
   cross-validation score and the confusion matrix;
5. serialises a self-describing **`ModelBundle`** to `app/models/myeye_model.pkl` with joblib.

The bundle stores the estimator *together with* the feature order, the class list, the
hyper-parameters, the metrics and the provenance metadata — a prediction can therefore never
silently use the wrong column ordering.

At least 4 samples spanning both classes are required. Anything below a few dozen samples per
class will overfit; treat the metrics from a small dataset as a smoke test, not as evidence.

## Prediction

`POST /api/predict` runs extraction → feature engineering → inference. The predictor caches
the loaded bundle and watches the file's modification time, so a freshly trained model is
picked up **without restarting the server**.

- `risk_score` — probability of the at-risk class, in `[0, 1]`. For multi-class label schemes
  it becomes the class-probability weighted mean rescaled onto `[0, 1]`, so the response
  contract stays stable if you later extend the labels.
- `confidence` — probability of the predicted class.
- `risk_level` — banded by `RISK_THRESHOLD_LOW` / `RISK_THRESHOLD_MODERATE`:

  | Score              | Level      |
  | ------------------ | ---------- |
  | `< 0.34`           | `Low`      |
  | `0.34 – 0.67`      | `Moderate` |
  | `≥ 0.67`           | `High`     |

## Database

SQLite, created automatically at start-up (`DATABASE_URL`, default
`backend/app/eye_tracking.db`), WAL mode enabled so readers never block on a writer.

```sql
CREATE TABLE test_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT    NOT NULL,   -- ISO-8601 UTC
    filename    TEXT    NOT NULL,
    risk_score  REAL    NOT NULL,
    risk_level  TEXT    NOT NULL,
    confidence  REAL    NOT NULL,
    model_type  TEXT,
    subject_id  TEXT,
    features    TEXT,               -- JSON
    metadata    TEXT                -- JSON
);
```

## Configuration

Nothing is hardcoded: every path, threshold and hyper-parameter is a field of
`Settings` in `app/config.py`, overridable through environment variables or `.env`.
See [`.env.example`](.env.example) for the annotated list. The most useful ones:

| Variable                     | Default              | Purpose                                    |
| ---------------------------- | -------------------- | ------------------------------------------ |
| `UPLOAD_DIR`                 | `app/uploads`        | Where recordings and per-frame CSVs land.  |
| `MODEL_DIR` / `MODEL_FILENAME` | `app/models` / `myeye_model.pkl` | Trained artefact location.  |
| `DATASET_DIR` / `DATASET_FILENAME` | `dataset` / `dataset.csv` | Aggregated dataset location. |
| `DATABASE_URL`               | `sqlite:///./app/eye_tracking.db` | SQLite file.                |
| `MODEL_TYPE`                 | `random_forest`      | Which registered implementation to train.  |
| `MODEL_PARAMS`               | JSON object          | Hyper-parameters for the estimator.        |
| `FEATURE_COLUMNS`            | the ten features     | Feature order fed to the model.            |
| `MAX_FRAMES` / `FRAME_RESIZE_WIDTH` | `3600` / `640` | Caps CPU cost per recording.            |
| `MIN_VALID_FRAME_RATIO`      | `0.30`               | Rejects recordings with too few detections.|
| `RISK_THRESHOLD_LOW` / `_MODERATE` | `0.34` / `0.67` | Risk band boundaries.                   |
| `CORS_ALLOW_ORIGINS`         | `*`                  | **Restrict this in production.**           |

## Architecture

Clean layering, with dependencies pointing inwards only:

```
app/api        HTTP handlers — parse, delegate, serialise. No business logic.
    ↓
app/dependencies  Dependency injection wiring (overridable in tests)
    ↓
app/ai/pipeline   Orchestration service — the only place the stages are chained
    ↓
app/ai/*          extract_feature → feature_engineering → train_model / predict_model
    ↓
app/database      Repository pattern over sqlite3
```

Patterns in use:

- **Strategy + Registry** (`app/ai/base.py`) — models are interchangeable behind
  `BaseRiskModel`, resolved by name from `MODEL_REGISTRY`.
- **Repository** (`DatasetRepository`, `TestHistoryRepository`) — persistence is isolated
  behind narrow interfaces.
- **Service / Facade** (`EyeTrackingPipeline`) — one entry point for the whole flow.
- **Dependency injection** (`app/dependencies.py`) — every collaborator is injected, so tests
  can replace any of them via `app.dependency_overrides`.
- **Settings singleton** (`get_settings`, `lru_cache`) — configuration is read once.

The AI layer imports nothing from FastAPI, so it is fully reusable from notebooks, batch
scripts and future training pipelines.

## Extending the model (LSTM / PyTorch)

Sequence models are the natural next step: the per-frame CSV keeps the full temporal signal
that the ten aggregated features throw away. Adding one takes three steps and touches **no**
API code:

```python
# app/ai/sequence_models.py
from app.ai.base import BaseRiskModel, TrainingMetrics, register_model

@register_model
class LSTMRiskModel(BaseRiskModel):
    """Sequence model over the per-frame gaze signal."""

    model_type = "lstm"

    def build_estimator(self):
        import torch.nn as nn
        return nn.LSTM(input_size=len(self.feature_columns), hidden_size=64, batch_first=True)

    def fit(self, features, labels) -> TrainingMetrics:
        ...   # training loop; return TrainingMetrics

    def predict_proba(self, features):
        ...   # return an (n_samples, n_classes) array
```

1. Implement `build_estimator`, `fit` and `predict_proba`.
2. Import the module from `app/ai/__init__.py` so the decorator runs.
3. Set `MODEL_TYPE=lstm`, or pass `{"model_type": "lstm"}` to `POST /api/train`.

`BaseRiskModel.save`/`load` handle persistence through `ModelBundle`; override them if your
framework needs its own serialisation format (e.g. `torch.save` for the state dict).

## Frontend integration

The backend is stateless with respect to the recording session — the frontend owns the camera
and the stimulus. For the best signal quality:

1. Record at **≥ 24 fps** with the face well lit and fully inside the frame.
2. Keep the ball motion **smooth and predictable** (sinusoidal or circular sweeps), 20–30 s.
3. Log the ball position on every animation frame and send it as `target_trajectory`, using
   the **same time origin as the video**. Times may be in seconds or milliseconds —
   milliseconds are detected automatically. This unlocks the meaningful `tracking_error`.
4. Prefer `.mp4`; `.webm` from `MediaRecorder` also works.

```js
const form = new FormData();
form.append("file", videoBlob, "recording.mp4");
form.append("subject_id", subjectId);
form.append("target_trajectory", JSON.stringify(ballPath)); // [{t, x, y}, ...]

const res = await fetch("http://127.0.0.1:8000/api/predict", { method: "POST", body: form });
const { risk_score, risk_level, confidence } = await res.json();
```

## Troubleshooting

| Symptom                                             | Cause and fix                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `409 ModelNotTrainedError`                          | No artefact yet — run `POST /api/train` (see [Quick start](#quick-start)).     |
| `400 DatasetError: Dataset not found`               | No labelled sample yet — upload with `label`, or run the synthetic generator.  |
| `422 NoFaceDetectedError`                           | Poor lighting, face out of frame, or the camera never focused. Re-record.      |
| `422 ModelTrainingError: single class`              | `dataset.csv` needs both `label=0` and `label=1` rows.                         |
| `400 InvalidVideoError: Unsupported video extension`| Extend `ALLOWED_VIDEO_EXTENSIONS`.                                             |
| `422 VideoProcessingError: OpenCV could not open`   | Codec not available to OpenCV. Re-encode to H.264 MP4.                         |
| Predictions differ between two runs on one video    | You sent `target_trajectory` on one call but not the other — `tracking_error` switched modes. |
| `ImportError: libGL.so.1` on Linux                  | Install `libgl1` and `libglib2.0-0`, or keep `opencv-python-headless`.         |
| Slow requests                                       | Lower `MAX_FRAMES` / `FRAME_RESIZE_WIDTH`; FaceMesh is CPU-bound.              |

---

## Licence & data handling

Prototype for research use. Uploaded recordings are biometric personal data: `.gitignore`
excludes `app/uploads/`, `dataset/` and the SQLite database from version control. Obtain
informed consent, keep the deployment inside your institution's approved infrastructure, and
lock down `CORS_ALLOW_ORIGINS` before exposing the API.
