# WhisperX microservice

Flask wrapper around [m-bain/whisperX](https://github.com/m-bain/whisperX).
Used by the main app to transcribe uploaded audio clips into text (Thai by
default, multi-language supported via `WHISPER_LANG`).

WhisperX = OpenAI Whisper running on faster-whisper / ctranslate2 (much faster
than vanilla Whisper) plus optional **word-level alignment** via wav2vec2.

## Run

```bash
# From the project root
docker compose up -d asr
docker compose logs -f asr   # watch the model download on first transcribe
```

The first transcription request triggers a model download:

| `WHISPER_MODEL` | Size | RAM (CPU int8) | Quality |
|-----------------|------|----------------|---------|
| `tiny`          | ~75 MB  | ~400 MB | weakest |
| `base`          | ~150 MB | ~500 MB | OK |
| `small`  (default) | ~500 MB | ~750 MB | good for Thai |
| `medium`        | ~1.5 GB | ~1.5 GB | very good |
| `large-v3`      | ~3 GB   | ~3 GB   | best, but slow on CPU |

Plus the per-language alignment model (`th` → wav2vec2-large-xlsr-53-th,
~1.2 GB) if `WHISPER_ALIGN=1`.

## Endpoints

| Method | Path                  | Purpose                                            |
|--------|-----------------------|----------------------------------------------------|
| GET    | `/health`             | `{ ok, model, device, main_loaded, ... }`          |
| POST   | `/transcribe`         | `{ "filename": "<hex>.webm", "language"?: "th" }` — reads from `/uploads/_audio` |
| POST   | `/transcribe/upload`  | Multipart `audio` — for ad-hoc curl tests          |

### Response shape

```json
{
  "ok": true,
  "text": "สวัสดี ครับ วันนี้ อากาศ ดี",
  "language": "th",
  "model": "small",
  "segments": [
    {
      "start": 0.12, "end": 1.85, "text": "สวัสดี ครับ",
      "words": [
        { "word": "สวัสดี", "start": 0.12, "end": 0.65, "score": 0.92 },
        { "word": "ครับ",  "start": 0.70, "end": 0.95, "score": 0.88 }
      ]
    }
  ],
  "timings": { "decode_sec": 0.12, "transcribe_sec": 4.21, "align_sec": 0.83, "total_sec": 5.16 }
}
```

`words` are present only when `WHISPER_ALIGN=1` AND the language has a
default alignment model in WhisperX.

## Environment variables

| Var | Default | Notes |
|-----|---------|-------|
| `WHISPER_MODEL`        | `small` | tiny / base / small / medium / large-v2 / large-v3 |
| `WHISPER_DEVICE`       | `cpu`   | set to `cuda` if you have GPU |
| `WHISPER_COMPUTE_TYPE` | `int8` (cpu) / `float16` (cuda) | `float32` for max precision |
| `WHISPER_LANG`         | `th`    | empty string = auto-detect |
| `WHISPER_ALIGN`        | `1`     | `0` to skip word-level alignment |
| `WHISPER_BATCH_SIZE`   | `8`     | bigger = faster but more RAM |

Override in `docker-compose.yml` or via the project `.env` file.

## Test from the host

Uncomment `ports: ["8000:8000"]` in compose first, then:

```bash
curl http://localhost:8000/health
curl -F audio=@sample.webm http://localhost:8000/transcribe/upload
```

## Architecture

```
sml_app (Node)            sml_asr (Python)
   │                         │
   │  POST /transcribe       │
   │  { filename }           │
   ├────────────────────────►│
   │                         ├─► whisperx.load_audio (ffmpeg → 16kHz mono)
   │                         ├─► faster-whisper.transcribe → segments
   │                         ├─► wav2vec2.align (optional) → word timestamps
   │  { text, segments,      │
   │    language, timings }  │
   │◄────────────────────────┤
```

Both containers share `./uploads` so the audio blob lives in one place;
whisperx mounts it read-only.

## Disk / memory

- Image size: ~2.5 GB (CPU-only torch — much smaller than CUDA-bundled wheels)
- RAM during inference (`small` + `int8`): ~750 MB
- CPU: ~real-time on a modern x86_64 (1 min audio ≈ 1 min processing on small)

## Disable transcription

Unset `ASR_URL` (or set to empty) in the `app` service environment. Existing
recordings stay in `transcript_status='pending'` which the UI shows as a
🔄 retry button.
