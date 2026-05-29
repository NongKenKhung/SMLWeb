"""
WhisperX Flask microservice
===========================
Endpoints
  GET  /health              → liveness + model state
  POST /transcribe          → body { "filename": "...", "summarise"?: bool } → transcript + (optional) summary
  POST /transcribe/upload   → multipart `audio` (no metadata) → same shape
  POST /summarise           → body { "text": "..." }          → { summary, action_items }

WhisperX = OpenAI Whisper (via ctranslate2 / faster-whisper for speed) +
optional word-level alignment via wav2vec2. Output is a list of `segments`
each with start/end/text and (when alignment is on) a `words` array with
per-word timing.

If OLLAMA_URL is set, every /transcribe call also asks Ollama to:
  1. Organise the transcript into a Markdown outline grouped by topic
     (## หัวข้อ / - bullet point — readable structure, no paraphrasing of intent)
  2. Extract any explicit action items as a JSON array (kept separate so the
     UI can show a TODO checklist alongside the outline)

Configuration (env vars)
  WHISPER_MODEL         "tiny" | "base" | "small" (default) | "medium" | "large-v3"
  WHISPER_DEVICE        "cpu" (default) | "cuda"
  WHISPER_COMPUTE_TYPE  "int8" (default for cpu) | "float16" | "float32"
  WHISPER_LANG          forced source language; "" = auto-detect (default "th")
  WHISPER_ALIGN         "1" (default) to run alignment for word-level timing
  WHISPER_BATCH_SIZE    transcription batch size (default 8)
  WHISPER_ALIGN_MODEL   custom HF wav2vec2 model for alignment
  NORMALIZE_AUDIO       "1" (default) to run ffmpeg dynaudnorm before whisper —
                        evens out loud/quiet sections in phone/laptop-mic recordings
                        so Whisper doesn't miss soft speakers
  OLLAMA_URL            Ollama server URL (default http://ollama:11434, empty = disable)
  OLLAMA_MODEL          model tag (default scb10x/llama3.2-typhoon2-3b-instruct, Thai-tuned)
"""
from __future__ import annotations
import json
import os
import tempfile
import threading
import time
import traceback
import urllib.request
import urllib.error
from pathlib import Path
from flask import Flask, jsonify, request

app = Flask(__name__)

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/uploads"))
AUDIO_DIR = UPLOAD_DIR / "_audio"

# Read settings once at startup so changes need a container restart.
MODEL_NAME    = os.environ.get("WHISPER_MODEL", "small")
DEVICE        = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE  = os.environ.get("WHISPER_COMPUTE_TYPE", "int8" if DEVICE == "cpu" else "float16")
DEFAULT_LANG  = os.environ.get("WHISPER_LANG", "th") or None
ENABLE_ALIGN  = os.environ.get("WHISPER_ALIGN", "1") == "1"
BATCH_SIZE    = int(os.environ.get("WHISPER_BATCH_SIZE", "8"))
# whisperx 3.8.x doesn't ship a default alignment model for Thai. Point it at a
# HuggingFace wav2vec2 model that does — defaults to the same model PyThaiASR
# uses. Empty = let whisperx pick its own default (fails for Thai).
ALIGN_MODEL   = os.environ.get("WHISPER_ALIGN_MODEL", "airesearch/wav2vec2-large-xlsr-53-th")
# Pre-process audio with ffmpeg dynaudnorm to even out loud/quiet parts before
# Whisper sees the audio. Default on — disable with NORMALIZE_AUDIO=0 for
# pristine studio recordings where boosting might add noise.
NORMALIZE_AUDIO = os.environ.get("NORMALIZE_AUDIO", "1") == "1"
# Ollama (optional) — generates a summary + action-items list per transcript
OLLAMA_URL    = os.environ.get("OLLAMA_URL", "").rstrip("/")
OLLAMA_MODEL  = os.environ.get("OLLAMA_MODEL", "scb10x/llama3.2-typhoon2-3b-instruct")

# Lazy globals — first request triggers model download (~250 MB for `small`,
# ~1.5 GB for `large-v3`). Cached in HF_HOME / TORCH_HOME volumes.
_model = None
_align_cache: dict[str, tuple] = {}
_load_lock = threading.Lock()
_loading = False


def _load_main():
    """Lazy-load the main Whisper model under the lock."""
    global _model, _loading
    if _model is not None:
        return _model
    with _load_lock:
        if _model is not None:
            return _model
        _loading = True
        try:
            print(f"[asr] loading whisperx model='{MODEL_NAME}' device={DEVICE} "
                  f"compute_type={COMPUTE_TYPE} lang={DEFAULT_LANG or 'auto'} ...", flush=True)
            t0 = time.time()
            import whisperx  # imported lazily so /health stays responsive on boot
            # Pass `language` at load time so whisperx doesn't run language-
            # detection on every clip ("No language specified, language will be
            # detected for each audio file (increases inference time)").
            load_kwargs = {"compute_type": COMPUTE_TYPE}
            if DEFAULT_LANG:
                load_kwargs["language"] = DEFAULT_LANG
            _model = whisperx.load_model(MODEL_NAME, DEVICE, **load_kwargs)
            # Enable TF32 *after* whisperx load — pyannote (loaded internally as
            # the VAD backbone) calls `torch.backends.cuda.matmul.allow_tf32 =
            # False` during init for reproducibility. Setting it before load
            # gets clobbered; setting it after sticks for every inference run.
            # ~1.5–2× speedup on wav2vec2 matmuls (RTX 30/40-series only).
            try:
                import torch
                if torch.cuda.is_available():
                    torch.backends.cuda.matmul.allow_tf32 = True
                    torch.backends.cudnn.allow_tf32 = True
            except Exception:
                pass
            print(f"[asr] main model ready in {time.time() - t0:.1f}s", flush=True)
        finally:
            _loading = False
    return _model


def _load_align(lang: str):
    """Lazy-load the per-language alignment model. Cached per language."""
    if lang in _align_cache:
        return _align_cache[lang]
    with _load_lock:
        if lang in _align_cache:
            return _align_cache[lang]
        try:
            t0 = time.time()
            import whisperx
            # If WHISPER_ALIGN_MODEL is set, prefer that (e.g. for languages
            # whisperx doesn't have a default for, like Thai). Otherwise let
            # whisperx pick its own per-language default.
            kwargs = {"language_code": lang, "device": DEVICE}
            if ALIGN_MODEL:
                kwargs["model_name"] = ALIGN_MODEL
                print(f"[asr] loading align model '{ALIGN_MODEL}' for '{lang}' ...", flush=True)
            else:
                print(f"[asr] loading default align model for '{lang}' ...", flush=True)
            model_a, metadata = whisperx.load_align_model(**kwargs)
            _align_cache[lang] = (model_a, metadata)
            print(f"[asr] align '{lang}' ready in {time.time() - t0:.1f}s", flush=True)
            return _align_cache[lang]
        except Exception as e:
            print(f"[asr] align unavailable for '{lang}': {e}", flush=True)
            _align_cache[lang] = None
            return None


def normalize_audio(src: Path) -> str:
    """Pre-process audio with ffmpeg's `dynaudnorm` filter so loud/quiet
    parts even out before WhisperX sees them. Meetings recorded on a phone
    or laptop mic typically have wildly varying levels (close speaker loud,
    far speaker barely audible); Whisper drops quiet segments or transcribes
    them as garbage. Dynamic normalisation boosts quiet parts and tames
    loud peaks in a single pass.

    Returns the path to a 16 kHz mono WAV in a temp dir — caller is
    responsible for cleanup. Falls back to the original path if ffmpeg
    fails so transcription never gets blocked.
    """
    import subprocess
    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False, dir="/tmp")
    out.close()
    try:
        subprocess.run([
            "ffmpeg", "-y", "-i", str(src),
            # dynaudnorm params tuned for speech:
            #   f=200ms frame  → tracks sentence-level loudness
            #   g=15 gauss     → smooth transitions (avoid pumping)
            #   p=0.9 peak     → leave ~10% headroom under 0 dBFS
            #   m=10 max gain  → can boost quiet parts up to +10 dB
            "-af", "dynaudnorm=f=200:g=15:p=0.9:m=10",
            "-ar", "16000", "-ac", "1",   # WhisperX expects 16 kHz mono anyway
            "-loglevel", "error",
            out.name,
        ], check=True, timeout=300)
        return out.name
    except Exception as e:
        print(f"[asr] normalize_audio failed ({e!r}); falling back to raw input", flush=True)
        try: os.remove(out.name)
        except Exception: pass
        return str(src)


def transcribe_path(src: Path) -> dict:
    """Run the full pipeline: normalize → ffmpeg-decode → whisper → (optional) align."""
    import whisperx

    t0 = time.time()
    # Volume-equalised copy in /tmp; deleted in the `finally` after whisperx finishes.
    norm_path = normalize_audio(src) if NORMALIZE_AUDIO else str(src)
    t_normalized = time.time()
    try:
        audio = whisperx.load_audio(norm_path)   # ffmpeg → 16kHz float32 mono ndarray
    finally:
        if NORMALIZE_AUDIO and norm_path != str(src):
            try: os.remove(norm_path)
            except Exception: pass
    t_loaded = time.time()

    model = _load_main()
    # ถ้า vRAM ไม่พอ ctranslate2 จะ throw std::runtime_error("CUDA failed
    # with error unknown error") (silent OOM) — ตัว C++ ก็ทำให้ Python ตาย
    # เลย. ตรวจจับไม่ได้ที่ Python; ทำได้แค่ลด batch_size แล้ว retry รอบเดียว
    # ก่อนยอมแพ้ — แค่นี้ก็ครอบคลุม OOM transient ส่วนใหญ่
    kwargs = {"batch_size": BATCH_SIZE}
    if DEFAULT_LANG:
        kwargs["language"] = DEFAULT_LANG
    try:
        result = model.transcribe(audio, **kwargs)
    except RuntimeError as e:
        if "CUDA" in str(e) and BATCH_SIZE > 1:
            fallback = max(1, BATCH_SIZE // 2)
            print(f"[asr] transcribe failed ({e}); retry with batch={fallback}", flush=True)
            kwargs["batch_size"] = fallback
            result = model.transcribe(audio, **kwargs)
        else:
            raise
    t_transcribed = time.time()
    detected_lang = result.get("language") or DEFAULT_LANG or "en"

    # Alignment (word-level timestamps). Best-effort — not all languages have a
    # default align model; we just skip if it fails.
    aligned_segments = result.get("segments", [])
    if ENABLE_ALIGN and aligned_segments:
        am = _load_align(detected_lang)
        if am:
            try:
                model_a, metadata = am
                aligned = whisperx.align(
                    aligned_segments, model_a, metadata,
                    audio, DEVICE, return_char_alignments=False,
                )
                aligned_segments = aligned.get("segments", aligned_segments)
            except Exception as e:
                print(f"[asr] align step failed: {e}", flush=True)

    full_text = " ".join((s.get("text") or "").strip() for s in aligned_segments).strip()

    # ปล่อย activation buffers ที่ค้างใน vRAM (model weights ยังคงอยู่ — แค่
    # ปล่อย scratch memory ของ batch ล่าสุด ~2-3 GB). จำเป็นเพราะแชร์ GPU
    # กับ Ollama ที่ต้องการ ~2 GB สำหรับ Typhoon2 — ถ้าไม่ free Ollama จะ
    # fall back ไป CPU ใช้เวลา > 5 นาที = backend abort timeout
    try:
        import torch, gc
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
    except Exception:
        pass

    t_done = time.time()

    return {
        "text": full_text,
        "language": detected_lang,
        "model": MODEL_NAME,
        "segments": aligned_segments,
        "timings": {
            "normalize_sec":  round(t_normalized - t0, 3),
            "decode_sec":     round(t_loaded - t_normalized, 3),
            "transcribe_sec": round(t_transcribed - t_loaded, 3),
            "align_sec":      round(t_done - t_transcribed, 3),
            "total_sec":      round(t_done - t0, 3),
        },
    }


def summarise_with_ollama(text: str, lang_hint: str = "th") -> dict:
    """Ask Ollama to organise the transcript into a Markdown outline + extract
    action items. Returns { summary: str, action_items: [str, ...] } where
    `summary` is a Markdown outline (## หัวข้อ + - bullet points) rather than a
    paraphrased sentence — keeps the column name for backward compat but the
    content shape changed (was a 1-3 sentence summary previously).

    Raises on failure."""
    if not OLLAMA_URL:
        raise RuntimeError("OLLAMA_URL not configured")
    if not text.strip():
        return {"summary": "", "action_items": []}

    lang_label = "Thai" if lang_hint == "th" else lang_hint or "the same language as the input"
    prompt = (
        f"You are a transcript organiser. Read the transcript below and "
        f"REORGANISE its content into a clear Markdown outline grouped by "
        f"topic. Do NOT paraphrase or summarise — keep the speakers' actual "
        f"points; only restructure them.\n\n"
        f"Output strictly a JSON object with exactly two keys:\n"
        f'  "summary": a Markdown string in {lang_label} formatted as:\n'
        f"      ## Topic heading\n"
        f"      - Bullet point capturing one idea/statement\n"
        f"      - Another bullet\n"
        f"      ## Next topic\n"
        f"      - ...\n"
        f"    Use 2-6 topics depending on length. Each bullet ≤ 1 line. "
        f"Order topics in the same order they appear in the transcript.\n"
        f'  "action_items": array of short action-item strings (in '
        f"{lang_label}) — only explicit TODOs / decisions / assignments. "
        f"Empty array if none.\n\n"
        f"Reply ONLY with the JSON object, no commentary.\n\n"
        f"Transcript:\n\"\"\"\n{text}\n\"\"\"\n"
    )
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",          # ask Ollama for guaranteed JSON output
        "options": { "temperature": 0.2 },
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    # Timeout long enough for cold-start model load on CPU
    with urllib.request.urlopen(req, timeout=300) as resp:
        raw = resp.read().decode("utf-8")
    parsed = json.loads(raw)
    out_text = parsed.get("response", "")
    # Ollama with format=json returns valid JSON in `response`
    try:
        data = json.loads(out_text)
    except Exception:
        data = {"summary": out_text.strip(), "action_items": []}
    return {
        "summary": str(data.get("summary") or "").strip(),
        "action_items": [str(x).strip() for x in (data.get("action_items") or []) if str(x).strip()][:20],
    }


# ── HTTP routes ─────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "model": MODEL_NAME,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "language": DEFAULT_LANG,
        "alignment": ENABLE_ALIGN,
        "main_loaded": _model is not None,
        "loading": _loading,
        "align_loaded": list(k for k, v in _align_cache.items() if v is not None),
        "audio_dir_exists": AUDIO_DIR.exists(),
        "ollama_enabled": bool(OLLAMA_URL),
        "ollama_model": OLLAMA_MODEL if OLLAMA_URL else None,
    })


@app.post("/summarise")
def summarise_endpoint():
    """Standalone summariser — give it text, get back summary + action items."""
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    lang = data.get("language") or "th"
    if not text:
        return jsonify({"error": "text required"}), 400
    try:
        result = summarise_with_ollama(text, lang)
        return jsonify({"ok": True, **result})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)[:500]}), 500


@app.post("/transcribe")
def transcribe_by_filename():
    data = request.get_json(silent=True) or {}
    name = (data.get("filename") or "").strip()
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return jsonify({"error": "invalid filename"}), 400
    src = AUDIO_DIR / name
    if not src.is_file():
        return jsonify({"error": f"file not found: {name}"}), 404
    try:
        result = transcribe_path(src)
        return jsonify({"ok": True, **result})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)[:500]}), 500


@app.post("/transcribe/upload")
def transcribe_uploaded():
    f = request.files.get("audio")
    if not f:
        return jsonify({"error": "audio file required"}), 400
    fd, tmp = tempfile.mkstemp(suffix=Path(f.filename or "x").suffix or ".bin")
    os.close(fd)
    try:
        f.save(tmp)
        result = transcribe_path(Path(tmp))
        return jsonify({"ok": True, **result})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)[:500]}), 500
    finally:
        try: os.unlink(tmp)
        except OSError: pass


if __name__ == "__main__":
    print(f"[asr] starting whisperx microservice on :8000")
    print(f"[asr] config: model={MODEL_NAME} device={DEVICE} compute={COMPUTE_TYPE} "
          f"lang={DEFAULT_LANG or '(auto)'} align={ENABLE_ALIGN} batch={BATCH_SIZE}")
    print(f"[asr] UPLOAD_DIR={UPLOAD_DIR}")
    # threaded=True keeps /health responsive while transcription runs;
    # the model itself is single-threaded so concurrent calls queue on the lock.
    app.run(host="0.0.0.0", port=8000, threaded=True)
