# PyThaiASR microservice — Flask wrapper around pythaiasr (wav2vec2 Thai model).
# Built on slim Python 3.11; ffmpeg installed for converting webm/mp4/ogg →
# 16kHz mono wav (the format the model expects). The first transcription will
# trigger the model download (~1.2GB) which is cached in /root/.cache.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/cache/huggingface \
    TORCH_HOME=/cache/torch \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system deps (ffmpeg for audio decode, libsndfile for soundfile, build tools for torchaudio)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        libsndfile1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache layer for python deps — only re-runs when requirements.txt changes
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Cache directory for downloaded models so it survives `docker compose up -d`
RUN mkdir -p /cache/huggingface /cache/torch

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -fs http://localhost:8000/health || exit 1

CMD ["python", "-u", "app.py"]
