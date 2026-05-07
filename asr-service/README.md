# PyThaiASR microservice

Flask wrapper around [PyThaiNLP/pythaiasr](https://github.com/PyThaiNLP/pythaiasr).
Used by the main app to transcribe uploaded audio clips into Thai text.

## Run

```bash
# From the project root
docker compose up -d asr
docker compose logs -f asr   # watch the model download on first start
```

The first request triggers a ~1.2 GB model download (cached in the
`asr_cache` Docker volume so subsequent restarts are fast).

## Endpoints

| Method | Path                  | Purpose                                              |
|--------|-----------------------|------------------------------------------------------|
| GET    | `/health`             | Liveness probe — returns `{ ok, model_loaded, ... }` |
| POST   | `/transcribe`         | Body: `{ "filename": "<hex>.webm" }` — reads from `/uploads/_audio` |
| POST   | `/transcribe/upload`  | Multipart `audio` — for ad-hoc curl tests            |

## Test from the host

```bash
# Bring up ports 8000 (uncomment in compose) first, then:
curl -F audio=@sample.webm http://localhost:8000/transcribe/upload
```

## Architecture

```
sml_app (Node)            sml_asr (Python)
   │                         │
   │  POST /transcribe       │
   │  { filename }           │
   ├────────────────────────►│
   │                         ├─► ffmpeg → 16 kHz mono WAV
   │                         ├─► pythaiasr(WAV) → Thai text
   │  { text, timings }      │
   │◄────────────────────────┤
```

Both containers share `./uploads` so the audio blob is on disk in one place;
ASR mounts it read-only.

## Disk / memory

- Image size: ~3 GB (PyTorch dominates)
- RAM during inference: ~1.5 GB
- CPU: a few seconds per minute of audio on a modern x86_64

## Disable transcription

Unset `ASR_URL` in `app`'s environment (or set to empty string) to skip
transcription. Existing rows stay in `transcript_status='pending'` which the
UI renders as a `🔄 Retry` button.
