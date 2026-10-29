from pathlib import Path
from tempfile import NamedTemporaryFile
from io import BytesIO
import os
import threading

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from faster_whisper import WhisperModel
from kokoro import KPipeline

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Local AI Hub", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Models are initialized on first use, not during server startup.
_kokoro_pipelines = {}
_whisper_model = None
_model_lock = threading.Lock()

VOICES = [
    {"id": "af_heart", "label": "Heart — American female"},
    {"id": "af_bella", "label": "Bella — American female"},
    {"id": "af_nicole", "label": "Nicole — American female"},
    {"id": "af_sarah", "label": "Sarah — American female"},
    {"id": "am_adam", "label": "Adam — American male"},
    {"id": "am_michael", "label": "Michael — American male"},
    {"id": "bf_emma", "label": "Emma — British female"},
    {"id": "bf_isabella", "label": "Isabella — British female"},
    {"id": "bm_george", "label": "George — British male"},
    {"id": "bm_lewis", "label": "Lewis — British male"},
]

def get_kokoro(language_code: str = "a"):
    with _model_lock:
        if language_code not in _kokoro_pipelines:
            _kokoro_pipelines[language_code] = KPipeline(lang_code=language_code)
        return _kokoro_pipelines[language_code]

def get_whisper():
    global _whisper_model
    with _model_lock:
        if _whisper_model is None:
            # CPU/int8 is the most reliable default on Windows and avoids
            # requiring a particular NVIDIA CUDA setup.
            model_name = os.getenv("WHISPER_MODEL", "base")
            device = os.getenv("WHISPER_DEVICE", "cpu")
            compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8" if device == "cpu" else "float16")
            _whisper_model = WhisperModel(model_name, device=device, compute_type=compute_type)
        return _whisper_model

@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/api/health")
def health():
    return {"status": "ok", "models": "loaded on first use", "whisper_default": os.getenv("WHISPER_MODEL", "base")}

@app.get("/api/voices")
def voices():
    return {"voices": VOICES}

@app.post("/api/tts")
def text_to_speech(text: str = Form(...), voice: str = Form("af_heart"), speed: float = Form(1.0)):
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Please enter some text.")
    if len(text) > 5000:
        raise HTTPException(status_code=400, detail="Please keep the text under 5,000 characters.")
    if voice not in {v["id"] for v in VOICES}:
        raise HTTPException(status_code=400, detail="Unsupported voice.")
    if not 0.5 <= speed <= 1.5:
        raise HTTPException(status_code=400, detail="Speed must be between 0.5 and 1.5.")

    try:
        pipeline = get_kokoro("a" if voice.startswith("a") else "b")
        chunks = []
        for _graphemes, _phonemes, audio in pipeline(text, voice=voice, speed=speed, split_pattern=r"\n+"):
            if audio is not None and len(audio):
                chunks.append(np.asarray(audio, dtype=np.float32))
        if not chunks:
            raise RuntimeError("Kokoro did not return audio. Try different text.")
        combined = np.concatenate(chunks)
        output = BytesIO()
        sf.write(output, combined, 24000, format="WAV", subtype="PCM_16")
        output.seek(0)
        return StreamingResponse(output, media_type="audio/wav", headers={"Content-Disposition": 'inline; filename="speech.wav"'})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Text-to-speech failed: {exc}") from exc

@app.post("/api/stt")
async def speech_to_text(audio: UploadFile = File(...), language: str = Form("auto")):
    if not audio:
        raise HTTPException(status_code=400, detail="No recording was received.")
    suffix = Path(audio.filename or "recording.webm").suffix
    if suffix.lower() not in {".webm", ".wav", ".mp3", ".m4a", ".ogg", ".mp4"}:
        suffix = ".webm"
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="The recording is empty.")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Recording is too large (maximum 25 MB).")

    temp_path = None
    try:
        with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            temp_path = tmp.name
        model = get_whisper()
        kwargs = {"beam_size": 5, "vad_filter": True}
        if language and language != "auto":
            kwargs["language"] = language
        segments, info = model.transcribe(temp_path, **kwargs)
        transcript = " ".join(segment.text.strip() for segment in segments).strip()
        return {"text": transcript, "language": info.language, "language_probability": round(float(info.language_probability), 3)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
