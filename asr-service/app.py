"""
PyThaiASR Flask microservice
============================
Endpoints
  GET  /health               → liveness probe
  POST /transcribe           → body { "filename": "<hex>.webm" } → { "text": "..." }
  POST /transcribe/upload    → multipart audio file (no metadata) → { "text": "..." }

Audio is converted to 16kHz mono WAV via ffmpeg before feeding into the model
(PyThaiASR expects WAV @ 16kHz). The model is loaded lazily on the first
request so the container starts up fast — first request takes ~30-60s, then
subsequent ones are quick.
"""
import os
import subprocess
import tempfile
import time
import threading
from pathlib import Path
from flask import Flask, request, jsonify

app = Flask(__name__)

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/uploads"))
AUDIO_DIR = UPLOAD_DIR / "_audio"

# Lazily-loaded ASR model. PyThaiASR downloads ~1.2GB of weights on first use,
# cached under HF_HOME for subsequent runs.
_asr_model = None
_asr_model_lock = threading.Lock()
_asr_model_loading = False


def get_model():
    """Returns the loaded ASR model, loading it on first call. Thread-safe."""
    global _asr_model, _asr_model_loading
    if _asr_model is not None:
        return _asr_model
    with _asr_model_lock:
        if _asr_model is not None:
            return _asr_model
        _asr_model_loading = True
        try:
            print("[asr] loading pythaiasr model... (first call downloads ~1.2GB)")
            t0 = time.time()
            from pythaiasr import ASR  # imported lazily so /health works during boot
            _asr_model = ASR()
            print(f"[asr] model ready in {time.time() - t0:.1f}s")
        finally:
            _asr_model_loading = False
    return _asr_model


def to_wav_16k(src: Path) -> Path:
    """Decode any audio container/codec to 16kHz mono PCM WAV via ffmpeg.
    Returns path to a temp file the caller is responsible for deleting."""
    fd, out_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    cmd = [
        "ffmpeg", "-y",
        "-i", str(src),
        "-ac", "1",          # mono
        "-ar", "16000",      # 16 kHz
        "-vn",               # no video
        "-f", "wav",
        out_path,
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        try: os.unlink(out_path)
        except OSError: pass
        raise RuntimeError(f"ffmpeg failed: {proc.stderr.decode(errors='replace')[:300]}")
    return Path(out_path)


def transcribe_file(src: Path) -> dict:
    t_start = time.time()
    wav_path = to_wav_16k(src)
    try:
        t_loaded = time.time()
        model = get_model()
        t_inference_start = time.time()
        text = model(str(wav_path))
        t_done = time.time()
        return {
            "text": text or "",
            "timings": {
                "ffmpeg_sec":   round(t_loaded - t_start, 3),
                "model_load_sec": round(t_inference_start - t_loaded, 3),
                "inference_sec":  round(t_done - t_inference_start, 3),
                "total_sec":      round(t_done - t_start, 3),
            },
        }
    finally:
        try: os.unlink(wav_path)
        except OSError: pass


@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "model_loaded": _asr_model is not None,
        "model_loading": _asr_model_loading,
        "audio_dir_exists": AUDIO_DIR.exists(),
    })


@app.post("/transcribe")
def transcribe_by_filename():
    """Caller passes { "filename": "abc123.webm" } and we read it from the
    shared /uploads/_audio volume — avoids re-uploading the file."""
    data = request.get_json(silent=True) or {}
    name = (data.get("filename") or "").strip()
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return jsonify({"error": "invalid filename"}), 400
    src = AUDIO_DIR / name
    if not src.is_file():
        return jsonify({"error": f"file not found: {name}"}), 404
    try:
        result = transcribe_file(src)
        return jsonify({"ok": True, **result})
    except Exception as e:
        print(f"[asr] error transcribing {name}: {e}")
        return jsonify({"error": str(e)[:300]}), 500


@app.post("/transcribe/upload")
def transcribe_uploaded():
    """Direct upload path for ad-hoc testing without the shared volume."""
    f = request.files.get("audio")
    if not f:
        return jsonify({"error": "audio file required"}), 400
    fd, tmp = tempfile.mkstemp(suffix=Path(f.filename or "x").suffix or ".bin")
    os.close(fd)
    try:
        f.save(tmp)
        result = transcribe_file(Path(tmp))
        return jsonify({"ok": True, **result})
    except Exception as e:
        return jsonify({"error": str(e)[:300]}), 500
    finally:
        try: os.unlink(tmp)
        except OSError: pass


if __name__ == "__main__":
    print(f"[asr] starting on :8000 · UPLOAD_DIR={UPLOAD_DIR}")
    # threaded=True so /health stays responsive while another request is
    # transcribing. The model itself is single-threaded though — concurrent
    # transcribes will queue on the model lock.
    app.run(host="0.0.0.0", port=8000, threaded=True)
