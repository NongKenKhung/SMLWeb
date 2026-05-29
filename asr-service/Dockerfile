# WhisperX microservice — Flask wrapper around https://github.com/m-bain/whisperX.
#
# GPU build — base image is the official pytorch/pytorch image with CUDA 12.1
# + cuDNN 9 already wired into PATH/LD_LIBRARY_PATH. That avoids the cuDNN-
# library-not-found dance that ctranslate2 (faster-whisper's runtime) hits
# when you pip-install torch on top of python:slim.
#
# Host requirements:
#   • NVIDIA driver + nvidia-container-toolkit on the host
#   • `asr` service in docker-compose.yml must reserve a GPU
#     (deploy.resources.reservations.devices with driver:nvidia)
#
# To revert to CPU-only: switch base back to `python:3.11-slim` and re-add the
# `pip install --index-url https://download.pytorch.org/whl/cpu torch ...` line.
FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/cache/huggingface \
    TORCH_HOME=/cache/torch

# Runtime deps: ffmpeg (audio decode), libsndfile (soundfile backend), curl (healthcheck).
# Build deps: build-essential + pkg-config + ffmpeg dev headers — PyAV (a
# transitive dep of pyannote.audio) builds from source because no matching
# manylinux wheel is available for the resolved version.
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

# torch/torchaudio come baked into the base image — skip the pip install.
# Just install whisperx + Flask + soundfile from requirements.txt.
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
