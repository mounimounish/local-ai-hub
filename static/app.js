const $ = (id) => document.getElementById(id);

const tabTts = $("tab-tts");
const tabStt = $("tab-stt");
const panelTts = $("panel-tts");
const panelStt = $("panel-stt");

function selectTab(which) {
  const tts = which === "tts";
  tabTts.classList.toggle("active", tts);
  tabStt.classList.toggle("active", !tts);
  tabTts.setAttribute("aria-selected", String(tts));
  tabStt.setAttribute("aria-selected", String(!tts));
  panelTts.classList.toggle("hidden", !tts);
  panelStt.classList.toggle("hidden", tts);
}
tabTts.addEventListener("click", () => selectTab("tts"));
tabStt.addEventListener("click", () => selectTab("stt"));

const ttsText = $("tts-text");
const charCount = $("char-count");
const speed = $("speed");
const speedValue = $("speed-value");
const ttsForm = $("tts-form");
const speakButton = $("speak-button");
const speakLabel = $("speak-label");
const ttsStatus = $("tts-status");
const audioResult = $("audio-result");
const audioPlayer = $("audio-player");
const downloadAudio = $("download-audio");
let currentAudioUrl = null;

function setStatus(el, message, kind = "") {
  el.textContent = message;
  el.className = "status" + (kind ? ` ${kind}` : "");
}
ttsText.addEventListener("input", () => {
  charCount.textContent = `${ttsText.value.length} / 5000`;
});
$("clear-tts").addEventListener("click", () => {
  ttsText.value = "";
  charCount.textContent = "0 / 5000";
  ttsText.focus();
});
speed.addEventListener("input", () => speedValue.textContent = `${Number(speed.value).toFixed(1)}×`);

ttsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = ttsText.value.trim();
  if (!text) {
    setStatus(ttsStatus, "Please enter some text first.", "error");
    return;
  }
  const form = new FormData();
  form.append("text", text);
  form.append("voice", $("voice").value);
  form.append("speed", speed.value);
  speakButton.disabled = true;
  speakLabel.textContent = "Generating audio…";
  audioResult.classList.add("hidden");
  setStatus(ttsStatus, "Loading Kokoro and generating speech. The first request may take a little longer.");
  try {
    const response = await fetch("/api/tts", { method: "POST", body: form });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || `Request failed (${response.status})`);
    }
    const blob = await response.blob();
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(blob);
    audioPlayer.src = currentAudioUrl;
    downloadAudio.href = currentAudioUrl;
    audioResult.classList.remove("hidden");
    setStatus(ttsStatus, "Speech generated successfully.", "success");
    await audioPlayer.play().catch(() => {});
  } catch (error) {
    setStatus(ttsStatus, error.message || "Could not generate speech.", "error");
  } finally {
    speakButton.disabled = false;
    speakLabel.textContent = "Generate speech";
  }
});

// Speech-to-text recording with MediaRecorder.
let mediaRecorder = null;
let recordedChunks = [];
let stream = null;
let recordingStartedAt = 0;
let timerInterval = null;
let recording = false;

const recordButton = $("record-button");
const stopButton = $("stop-button");
const recordButtonLabel = $("record-button-label");
const recordVisual = $("record-visual");
const recordTitle = $("record-title");
const recordDescription = $("record-description");
const timer = $("timer");
const sttStatus = $("stt-status");
const transcriptCard = $("transcript-card");
const transcript = $("transcript");

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}
function updateTimer() {
  timer.textContent = formatTime((Date.now() - recordingStartedAt) / 1000);
}
function bestMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return types.find(type => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || "";
}

recordButton.addEventListener("click", async () => {
  if (recording) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus(sttStatus, "Your browser does not support microphone recording. Try the latest Chrome or Edge.", "error");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    const mimeType = bestMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.addEventListener("dataavailable", event => {
      if (event.data && event.data.size > 0) recordedChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", handleRecordingStop, { once: true });
    mediaRecorder.start(250);
    recording = true;
    recordingStartedAt = Date.now();
    timer.textContent = "00:00";
    timerInterval = setInterval(updateTimer, 250);
    recordButton.classList.add("is-recording");
    recordButtonLabel.textContent = "Recording…";
    recordTitle.textContent = "Listening to your voice";
    recordDescription.textContent = "Speak clearly. Press Stop recording when you are finished.";
    recordVisual.classList.add("recording");
    stopButton.classList.remove("hidden");
    transcriptCard.classList.add("hidden");
    setStatus(sttStatus, "Recording in progress…");
  } catch (error) {
    setStatus(sttStatus, error.name === "NotAllowedError"
      ? "Microphone permission was denied. Allow microphone access in your browser settings and try again."
      : `Could not start microphone: ${error.message}`, "error");
  }
});

stopButton.addEventListener("click", () => {
  if (mediaRecorder && recording && mediaRecorder.state !== "inactive") mediaRecorder.stop();
});

async function handleRecordingStop() {
  recording = false;
  clearInterval(timerInterval);
  updateTimer();
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  recordButton.classList.remove("is-recording");
  recordButtonLabel.textContent = "Record again";
  recordTitle.textContent = "Recording complete";
  recordDescription.textContent = "Your recording is being transcribed locally.";
  recordVisual.classList.remove("recording");
  stopButton.classList.add("hidden");

  const type = recordedChunks[0]?.type || "audio/webm";
  const extension = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "mp4" : "webm";
  const blob = new Blob(recordedChunks, { type });
  if (!blob.size) {
    setStatus(sttStatus, "No audio was captured. Please try recording again.", "error");
    return;
  }

  const form = new FormData();
  form.append("audio", blob, `recording.${extension}`);
  form.append("language", $("language").value);
  recordButton.disabled = true;
  setStatus(sttStatus, "Transcribing audio with faster-whisper. The first run downloads the model and may take a few minutes.");
  try {
    const response = await fetch("/api/stt", { method: "POST", body: form });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || `Request failed (${response.status})`);
    transcript.value = result.text || "";
    $("detected-language").textContent = `Detected language: ${result.language || "unknown"} (${Math.round((result.language_probability || 0) * 100)}% confidence)`;
    transcriptCard.classList.remove("hidden");
    recordTitle.textContent = "Transcription ready";
    recordDescription.textContent = "Review, edit, or copy the text below.";
    setStatus(sttStatus, result.text ? "Transcription completed." : "No speech was detected. Try a longer or clearer recording.", result.text ? "success" : "");
  } catch (error) {
    setStatus(sttStatus, error.message || "Transcription failed.", "error");
    recordTitle.textContent = "Something went wrong";
    recordDescription.textContent = "You can record again and retry.";
  } finally {
    recordButton.disabled = false;
  }
}

$("copy-transcript").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(transcript.value);
    $("copy-transcript").textContent = "Copied!";
    setTimeout(() => $("copy-transcript").textContent = "Copy text", 1500);
  } catch {
    transcript.select();
    document.execCommand("copy");
    setStatus(sttStatus, "Transcript copied.", "success");
  }
});
$("clear-transcript").addEventListener("click", () => {
  transcript.value = "";
  transcriptCard.classList.add("hidden");
});
window.addEventListener("beforeunload", () => {
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  if (stream) stream.getTracks().forEach(track => track.stop());
});
