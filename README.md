# Local AI Hub

Local website with two features:
- **Text to Speech:** Kokoro TTS generates speech from text and plays a WAV file.
- **Speech to Text:** browser `MediaRecorder` records your microphone; faster-whisper transcribes it locally.

No cloud APIs, API keys, or Ollama are used. The first run needs internet access to install packages and download model weights. After those downloads, inference runs locally.

## Requirements
- Windows 10/11
- Python 3.11
- Microphone and a current Chrome/Edge browser

## Setup (PowerShell)
Open PowerShell in this project folder.

```powershell
# Install uv if it is not installed
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# Restart PowerShell if `uv` is not recognized
uv python install 3.11

# Create the project-local virtual environment and install dependencies
uv venv .venv --python 3.11
uv pip install --python .venv\\Scripts\\python.exe -e .
```

Start the server with the local virtual environment:

```powershell
.\\.venv\\Scripts\\python.exe -m uvicorn main:app --reload
```

Open http://127.0.0.1:8000 in Chrome or Edge and allow microphone access.

## Models
- Kokoro downloads its model/voice assets on first use.
- faster-whisper downloads the `base` model on first use.
- Default transcription configuration is CPU + int8 for compatibility.
- Optional environment variables: `WHISPER_MODEL` (default `base`; e.g. `tiny`, `small`), `WHISPER_DEVICE` (default `cpu`), and `WHISPER_COMPUTE_TYPE` (default `int8`).

## Troubleshooting
- **Microphone unavailable:** use `http://127.0.0.1:8000`, check Windows microphone permissions, and allow browser microphone access.
- **First request takes time:** model files are downloaded and initialized on first use.
- **Python issue:** run `uv python install 3.11`.
- **Port busy:** start with `.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8001`, then open http://127.0.0.1:8001.

## Directory
```text
local-ai-hub/
├── .venv/                 # Created on your computer during setup
├── main.py
├── pyproject.toml
├── .python-version
├── .gitignore
├── README.md
└── static/
    ├── index.html
    ├── styles.css
    └── app.js
```

The `.venv` folder is created locally by the setup commands and is intentionally not included in the ZIP because virtual environments are machine-specific and large.
