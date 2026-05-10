# WhisperX microservice — Flask wrapper around https://github.com/m-bain/whisperX.
# Built on slim Python 3.11; ffmpeg installed for any-format audio decoding.
# We install the CPU-only torch wheels first (much smaller than the default
# bundled-CUDA wheels), then let pip resolve the rest.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/cache/huggingface \
    TORCH_HOME=/cache/torch \
    OMP_NUM_THREADS=2

# Runtime deps: ffmpeg (audio decode), libsndfile (soundfile backend), curl (healthcheck).
# Build deps: build-essential + pkg-config + ffmpeg dev headers — PyAV (a
# transitive dep of pyannote.audio) builds from source on slim-bookworm
# because no matching manylinux wheel is available for the resolved version.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        libsndfile1 \
        curl \
        build-essential \
        pkg-config \
        libavformat-dev libavcodec-dev libavdevice-dev libavutil-dev \
        libswresample-dev libswscale-dev libavfilter-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CPU-only torch + torchaudio first so we don't pull the ~2 GB CUDA
# variants. WhisperX requires torch >= 2.5.1.
RUN pip install --no-cache-dir \
    --index-url https://download.pytorch.org/whl/cpu \
    torch==2.5.1 torchaudio==2.5.1

# Now the rest. WhisperX picks up the existing torch instead of pulling its own.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Pre-create cache dirs so they persist into the asr_cache volume mount.
RUN mkdir -p /cache/huggingface /cache/torch

EXPOSE 8000

# Generous start-period because the first request triggers a model download.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -fs http://localhost:8000/health || exit 1

CMD ["python", "-u", "app.py"]
