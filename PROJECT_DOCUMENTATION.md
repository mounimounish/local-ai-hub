# Local AI Hub — Detailed Project Documentation

## 1. Project Purpose

Local AI Hub is a private, browser-based speech application that runs text-to-speech and speech-to-text models on the user's local computer.

It does not use cloud AI APIs and does not require API keys. The first use may download model assets from the internet, but speech generation and transcription run locally after initialization.

The application provides two main tools:

1. **Text to Speech (TTS)** — turns typed text into spoken WAV audio using Kokoro.
2. **Speech to Text (STT)** — records audio from the browser microphone and converts it to text using faster-whisper.

## 2. Technology Stack

| Layer | Technology | Responsibility |
|---|---|---|
| Web server/API | FastAPI | Defines HTTP routes and validates requests |
| ASGI server | Uvicorn | Runs the FastAPI application locally |
| Text-to-speech | Kokoro | Converts text into speech audio |
| Speech-to-text | faster-whisper | Transcribes uploaded audio |
| Audio processing | NumPy, SoundFile | Combines and encodes generated audio |
| Frontend | HTML, CSS, JavaScript | Displays the interface and communicates with the API |
| Browser recording | MediaRecorder API | Records microphone audio |
| Dependency management | uv / pyproject.toml | Installs and manages Python dependencies |

## 3. Project Structure

```text
local-ai-hub/
├── main.py                    # FastAPI backend and AI model integration
├── pyproject.toml             # Project metadata and Python dependencies
├── README.md                  # Quick setup and usage guide
├── PROJECT_DOCUMENTATION.md   # Detailed technical documentation
├── .python-version            # Preferred Python version
├── .gitignore                 # Files excluded from version control
└── static/
    ├── index.html             # Main web interface
    ├── app.js                 # Browser interactions and API calls
    └── styles.css             # User interface styling
```

## 4. Application Architecture

```text
Browser UI
    │
    ├── GET /
    │       └── Returns static/index.html
    │
    ├── POST /api/tts
    │       ├── Sends text, voice, and speed
    │       ├── FastAPI validates the request
    │       ├── Kokoro generates audio chunks
    │       ├── Audio chunks are combined
    │       └── A WAV response is returned to the browser
    │
    └── POST /api/stt
            ├── Sends recorded microphone audio
            ├── FastAPI writes temporary audio
            ├── faster-whisper transcribes it
            ├── Temporary audio is deleted
            └── JSON transcription is returned
```

The browser communicates with the local backend over HTTP. Model inference occurs on the machine running FastAPI, not in the web browser.

## 5. Backend Breakdown: `main.py`

### 5.1 Imports

`main.py` imports standard-library modules for filesystem and temporary-file handling, third-party audio libraries, FastAPI components, and the two AI frameworks.

Important imports include:

- `Path` — resolves paths relative to `main.py`.
- `NamedTemporaryFile` — stores uploaded recordings temporarily.
- `BytesIO` — creates an in-memory WAV file without writing it to disk.
- `os` — reads environment variables and checks/deletes temporary files.
- `threading.Lock` — protects lazy model initialization.
- `numpy` — combines generated audio arrays.
- `soundfile` — encodes the final WAV stream.
- `FastAPI` — creates the web application and API routes.
- `WhisperModel` — loads and runs faster-whisper.
- `KPipeline` — loads and runs Kokoro TTS pipelines.

### 5.2 Project paths and application setup

```python
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
```

These paths locate [static/](/Users/mouni/OneDrive/Desktop/local-ai-hub/local-ai-hub/static) reliably, even when the application is launched from another working directory.

```python
app = FastAPI(title="Local AI Hub", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
```

This creates the FastAPI application and serves frontend resources under `/static`.

### 5.3 Lazy model initialization

```python
_kokoro_pipelines = {}
_whisper_model = None
_model_lock = threading.Lock()
```

The models are initialized only when a model-dependent endpoint is called for the first time. This keeps server startup fast and avoids allocating model memory unless the user needs the feature.

The `_model_lock` makes initialization thread-safe. If multiple browser requests arrive together, one request can initialize a model while other requests wait instead of creating duplicate model instances.

### 5.4 Kokoro pipelines

The `get_kokoro()` function provides Kokoro pipelines and caches them by language code:

```python
pipeline = get_kokoro("a")
```

- `a` represents American English voices.
- `b` represents British English voices.

A pipeline is created only once per language group and reused by later requests. Kokoro assets are downloaded on first use when required.

### 5.5 Supported voices

The backend defines the allowed voices in `VOICES`. Requests cannot use arbitrary voice identifiers. This validation provides a known list of options and keeps frontend and backend behavior aligned.

The available voice groups are:

- American female: Heart, Bella, Nicole, Sarah
- American male: Adam, Michael
- British female: Emma, Isabella
- British male: George, Lewis

### 5.6 Whisper model configuration

The `get_whisper()` function reads model settings from environment variables:

| Environment variable | Default | Purpose |
|---|---|---|
| `WHISPER_MODEL` | `base` | Selects the model size |
| `WHISPER_DEVICE` | `cpu` | Selects CPU or GPU execution |
| `WHISPER_COMPUTE_TYPE` | `int8` on CPU; `float16` otherwise | Controls model precision |

Example configuration in PowerShell:

```powershell
$env:WHISPER_MODEL="small"
$env:WHISPER_DEVICE="cpu"
$env:WHISPER_COMPUTE_TYPE="int8"
```

The selected Whisper model is cached in `_whisper_model` for reuse across transcription requests.

## 6. API Reference

### 6.1 `GET /`

Returns the main HTML interface, [index.html](/Users/mouni/OneDrive/Desktop/local-ai-hub/local-ai-hub/static/index.html).

Response type: HTML file.

### 6.2 `GET /api/health`

Checks whether the backend is running and reports the default Whisper model name.

Example response:

```json
{
  "status": "ok",
  "models": "loaded on first use",
  "whisper_default": "base"
}
```

### 6.3 `GET /api/voices`

Returns the supported Kokoro voices.

Example response shape:

```json
{
  "voices": [
    {
      "id": "af_heart",
      "label": "Heart — American female"
    }
  ]
}
```

### 6.4 `POST /api/tts`

Converts submitted text to speech.

**Form fields:**

| Field | Type | Default | Validation |
|---|---|---|---|
| `text` | string | Required | Non-empty and maximum 5,000 characters |
| `voice` | string | `af_heart` | Must be a supported voice ID |
| `speed` | float | `1.0` | Must be between 0.5 and 1.5 |

Example request:

```text
text=Welcome to Local AI Hub&voice=af_heart&speed=1.0
```

**Success response:**

- Content type: `audio/wav`
- Filename suggestion: `speech.wav`
- Audio sample rate: 24,000 Hz

**TTS processing steps:**

1. Validate text, voice, and speed.
2. Select the `a` or `b` Kokoro pipeline based on the voice prefix.
3. Pass text and generation options to Kokoro.
4. Receive one or more NumPy audio arrays.
5. Concatenate the arrays.
6. Write a 16-bit PCM WAV file into memory.
7. Return the memory stream using `StreamingResponse`.

Kokoro may produce multiple chunks, especially for longer text or newline-separated content. Concatenating these chunks produces one continuous audio response.

### 6.5 `POST /api/stt`

Transcribes uploaded microphone audio.

**Form fields:**

| Field | Type | Default | Purpose |
|---|---|---|---|
| `audio` | uploaded file | Required | Browser recording to transcribe |
| `language` | string | `auto` | Spoken language hint or `auto` |

Supported file extensions include:

- `.webm`
- `.wav`
- `.mp3`
- `.m4a`
- `.ogg`
- `.mp4`

Unknown extensions are replaced with `.webm` to help Whisper and temporary-file tooling handle the recording.

**Upload limits:**

- Maximum size: 25 MB
- Empty recordings return HTTP 400
- Oversized recordings return HTTP 413

**Success response:**

```json
{
  "text": "Your transcribed speech",
  "language": "en",
  "language_probability": 0.995
}
```

**STT processing steps:**

1. Read the uploaded file asynchronously.
2. Validate its contents and size.
3. Save it temporarily in the operating system's temporary directory.
4. Initialize Whisper if necessary.
5. Configure beam search and voice activity detection.
6. Transcribe the recording.
7. Join segment text into one transcript.
8. Delete the temporary recording.
9. Return detected language information and transcript text.

Whisper is configured with `beam_size=5`, providing a balance between transcription quality and processing time. `vad_filter=True` asks faster-whisper to ignore non-speech sections detected by voice activity detection.

If a language is specified, it is passed to Whisper. Otherwise, Whisper detects it automatically.

## 7. Frontend Breakdown

### 7.1 `index.html`

[index.html](/Users/mouni/OneDrive/Desktop/local-ai-hub/local-ai-hub/static/index.html) defines the two-tab interface:

- Text to Speech panel
- Speech to Text panel

It also contains the text area, voice selector, speech-speed slider, microphone controls, transcription area, status messages, audio player, and copy/clear buttons.

### 7.2 `app.js`

[app.js](/Users/mouni/OneDrive/Desktop/local-ai-hub/local-ai-hub/static/app.js) handles browser behavior and API communication.

#### Tab switching

JavaScript switches the active tab by updating CSS classes and accessibility attributes.

#### Text-to-speech submission

When the user submits the TTS form:

1. The text is trimmed and validated.
2. A `FormData` payload is created.
3. The browser sends a `POST` request to `/api/tts`.
4. On success, the response is converted into a browser Blob URL.
5. The browser loads it in the `<audio>` element and attempts playback.
6. The result can be downloaded as a WAV file.

The form also disables the generate button while processing to avoid duplicate requests.

#### Microphone recording

When recording starts:

1. The browser requests microphone permission with `getUserMedia()`.
2. A suitable MediaRecorder MIME type is selected.
3. Recorded data is collected in chunks every 250 milliseconds.
4. A timer shows recording duration.
5. The microphone tracks are stopped when recording ends.

When recording stops:

1. Audio chunks are combined into one Blob.
2. An extension such as `.webm`, `.ogg`, or `.mp4` is chosen from the MIME type.
3. The Blob is added to `FormData`.
4. The browser sends it to `/api/stt`.
5. The returned transcript appears in the editable textarea.

The browser must support `MediaRecorder`. The frontend recommends Chrome or Edge when MediaRecorder is unavailable or the microphone cannot be accessed.

## 8. Request Flow and Error Handling

### Text-to-speech request flow

```text
User enters text
  -> JavaScript validates the input
  -> POST /api/tts
  -> FastAPI validates fields
  -> Kokoro generates audio
  -> Backend returns WAV
  -> Browser plays/downloads audio
```

### Speech-to-text request flow

```text
User grants microphone permission
  -> Browser records audio
  -> STOP creates an audio Blob
  -> POST /api/stt
  -> Backend saves temporary recording
  -> Whisper generates text segments
  -> Backend deletes temporary recording
  -> Browser displays JSON results
```

Backend errors are converted into HTTP exceptions with user-readable messages. Frontend JavaScript reads the JSON `detail` field and shows the error in the status area.

## 9. Privacy and Temporary Data

### Privacy properties

- No cloud API keys are used.
- Audio is not sent to OpenAI, Gemini, or another hosted AI service.
- Recordings go to the backend running on the local machine.
- The browser and backend communicate over localhost in the normal setup.
- TTS generation does not create user audio files; it streams WAV data from memory.

### Temporary recording handling

For STT, the uploaded recording is written to a temporary file because faster-whisper accepts a filesystem path. The backend removes that file in a `finally` block, including after an exception.

Still, downloaded AI model weights remain cached on disk according to Kokoro and faster-whisper behavior.

## 10. Performance and Model Behavior

Model loading is the main startup cost. The first Kokoro or Whisper request may take longer because it must:

- Download model assets if not cached
- Initialize the selected model
- Allocate CPU memory
- Process the first audio request

Subsequent requests are faster because pipelines and models are cached in server memory.

General performance factors include:

- Input text length
- Recording duration
- Whisper model size
- CPU/GPU capability
- `WHISPER_COMPUTE_TYPE`
- Available RAM

A `tiny` or `base` Whisper model uses less memory and is faster than `small`, `medium`, or `large`, but it may produce lower transcription accuracy.

## 11. Setup and Running

### Requirements

- Windows 10/11
- Python 3.11 or 3.12
- Chrome or Edge
- Microphone access

### Installation

```powershell
uv python install 3.11
uv venv .venv --python 3.11
uv pip install --python .venv\Scripts\python.exe -e .
```

### Start the server

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Then open:

```text
http://127.0.0.1:8000
```

### Run on a different port

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8001
```

## 12. Troubleshooting

### Microphone is not available

- Use `http://127.0.0.1:8000` rather than a public HTTP URL.
- Allow microphone access in browser settings.
- Check Windows Privacy settings for microphone access.
- Try a current Chrome or Edge release.

### First request is slow

- Model weights may still be downloading.
- Kokoro assets may be initializing.
- Whisper may be loading into memory for the first time.

### Port 8000 is busy

Start the server on another port, such as 8001, and open that URL.

### Server cannot find static files

Run the application from the project directory or keep [main.py](/Users/mouni/OneDrive/Desktop/local-ai-hub/local-ai-hub/main.py), [static/](/Users/mouni/OneDrive/Desktop/local-ai-hub/local-ai-hub/static), and [index.html](/Users/mouni/OneDrive/Desktop/local-ai-hub/local-ai-hub/static/index.html) together. `main.py` resolves static paths relative to itself.

## 13. Development Notes

### Adding a voice

A voice must be added consistently to:

1. `VOICES` in `main.py`
2. The voice `<select>` options in `index.html`

A new voice should also be verified as supported by Kokoro and use the correct language pipeline (`a` or `b`).

### Changing the Whisper model

Set `WHISPER_MODEL` before starting the server. Examples include `tiny`, `base`, `small`, or larger supported model names supported by the installed faster-whisper version.

### Improving text-to-speech quality

Long text should be segmented cleanly, and punctuation and paragraph breaks should be used. Kokoro receives newline-separated text through its `split_pattern` setting.

### Improving transcription quality

- Use a quiet recording environment.
- Speak clearly and near the microphone.
- Select the known language instead of auto-detection when possible.
- Use a larger Whisper model if system resources permit.
- Avoid clipping, excessive background noise, and very quiet recordings.

## 14. Limitations

- It requires sufficient disk space and memory for model downloads.
- CPU-only transcription can be slow on longer recordings.
- Browser microphone access can behave differently between browser and operating system combinations.
- The first Kokoro and Whisper requests require time and potentially internet access for downloads.
- Faster-whisper transcription is performed locally but is still affected by model size and audio quality.
- The backend processes one machine's local resources and is not designed as a multi-user production service without additional authentication and scaling controls.

## 15. Summary

[main.py](/Users/mouni/OneDrive/Desktop/local-ai-hub/local-ai-hub/main.py) is the central backend integration layer. It:

1. Starts FastAPI.
2. Serves the frontend.
3. Lazily loads Kokoro and faster-whisper.
4. Validates API requests.
5. Converts text to WAV audio.
6. Converts uploaded recordings to JSON transcription results.
7. Cleans up temporary audio files.

The browser handles recording and display through [app.js](/Users/mouni/OneDrive/Desktop/local-ai-hub/local-ai-hub/static/app.js), while FastAPI and the local AI libraries perform inference on the computer.
