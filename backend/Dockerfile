# =============================================================================
# MyEye Risk API — production image
#
# Two stages: Node builds the Next.js client, Python runs the API and serves
# the built client from the same origin. Shipping one image keeps the session
# cookie same-origin (no CORS, no SameSite=None) and means the deployment host
# never needs Node installed.
#
#   docker build -t myeye:latest ./backend
# =============================================================================

# --- Stage 1: build the web client -------------------------------------------
FROM node:22-slim AS web

WORKDIR /build

# Copy manifests first so `npm ci` is cached until a dependency actually changes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
# `next/font` downloads Prompt here and self-hosts it, so the running container
# never contacts Google and works on an isolated network.
RUN npm run build


# --- Stage 2: runtime --------------------------------------------------------
FROM python:3.12-slim AS runtime

# MediaPipe pulls in opencv-contrib-python (not the headless build), which links
# against libGL and glib even when no window is ever opened. libgomp is needed
# by scikit-learn's OpenMP threading.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
# Admin utilities: manage_users.py, generate_synthetic_dataset.py, smoke_test.py
COPY scripts/ ./scripts/
# Served when the Next.js build is unavailable.
COPY frontend-legacy/ ./frontend-legacy/

# Only the built output is copied; node_modules and sources stay in stage 1.
COPY --from=web /build/out/ ./frontend/out/

# All mutable state lives under /app/data, never inside /app/app. Mounting a
# volume over the package directory would hide the application code itself.
# Keeping it in one tree also means a single volume to back up.
RUN useradd --system --create-home --uid 10001 myeye \
    && mkdir -p /app/data/uploads /app/data/models /app/data/dataset /app/data/logs \
    && chown -R myeye:myeye /app

ENV UPLOAD_DIR=/app/data/uploads \
    MODEL_DIR=/app/data/models \
    DATASET_DIR=/app/data/dataset \
    LOG_DIR=/app/data/logs \
    DATABASE_URL=sqlite:////app/data/myeye.db

USER myeye

EXPOSE 8000

# Uses the API's own readiness probe, so an unhealthy database or a failed
# start-up is reported to the orchestrator rather than only to the log.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
