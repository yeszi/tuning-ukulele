import { detectPitch } from "./pitchDetector.js";
import { detectChordFromChroma } from "./tuner.js";

/* ----------------------------
   DOM refs (guard if missing)
   ---------------------------- */
const startBtn = document.getElementById("startBtn");
const chordLabel = document.getElementById("chordLabel");
const chordScore = document.getElementById("chordScore");

const spectroCanvas = document.getElementById("spectroCanvas");
const chromaCanvas = document.getElementById("chromaCanvas");

const needleG = document.getElementById("needleG");
const needleC = document.getElementById("needleC");
const needleE = document.getElementById("needleE");
const needleA = document.getElementById("needleA");

const freqG = document.getElementById("freqG");
const freqC = document.getElementById("freqC");
const freqE = document.getElementById("freqE");
const freqA = document.getElementById("freqA");

const thresholdInput = document.getElementById("threshold");
const chromaThresh = document.getElementById("chromaThresh");
const modeSelect = document.getElementById("modeSelect");

const logEl = document.getElementById("log");
const uiLog = (m) => {
  if (window?.UKCOZY?.log) window.UKCOZY.log(m);
  else if (logEl) {
    logEl.textContent += `[${new Date().toLocaleTimeString()}] ${m}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  } else console.log("[UkCozy] " + m);
};

/* ----------------------------
   Basic guards: required DOM
   ---------------------------- */
if (!startBtn) uiLog("WARNING: startBtn not found");
if (!spectroCanvas || !chromaCanvas) uiLog("WARNING: spectroCanvas/chromaCanvas not found");

/* ----------------------------
   Audio state
   ---------------------------- */
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let micStream = null;
let running = false;

/* ----------------------------
   Canvas contexts (guard)
   ---------------------------- */
const spCtx = spectroCanvas ? spectroCanvas.getContext("2d") : null;
const chCtx = chromaCanvas ? chromaCanvas.getContext("2d") : null;

function resizeCanvas() {
  if (!spectroCanvas || !chromaCanvas) return;
  spectroCanvas.width = spectroCanvas.clientWidth || 400;
  spectroCanvas.height = spectroCanvas.clientHeight || 140;
  chromaCanvas.width = chromaCanvas.clientWidth || 400;
  chromaCanvas.height = chromaCanvas.clientHeight || 64;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

/* ----------------------------
   Helpers: chroma from FFT magnitude
   ---------------------------- */
function computeChroma(mag, sampleRate, fftSize) {
  const chroma = Array(12).fill(0);
  if (!mag || mag.length === 0) return chroma;

  for (let i = 0; i < mag.length; i++) {
    const freq = i * (sampleRate / fftSize);
    if (freq < 60 || freq > 5000) continue;
    const midi = Math.round(12 * Math.log2(freq / 440) + 69);
    const pc = ((midi % 12) + 12) % 12;
    chroma[pc] += mag[i];
  }
  const max = Math.max(...chroma);
  if (max > 0) for (let i = 0; i < 12; i++) chroma[i] /= max;
  return chroma;
}

/* ----------------------------
   Permission helper
   ---------------------------- */
async function checkMicrophonePermission() {
  try {
    if (!navigator.permissions) return "unknown";
    const status = await navigator.permissions.query({ name: "microphone" });
    return status.state; // 'granted' | 'prompt' | 'denied'
  } catch (e) {
    return "unknown";
  }
}

/* ----------------------------
   Start audio (robust)
   ---------------------------- */
async function start() {
  if (running) return;
  try {
    // permission quick-check
    const state = await checkMicrophonePermission();
    if (state === "denied") {
      uiLog("Microphone permission is denied — allow microphone in browser settings.");
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // resume if suspended (Chrome mobile/desktop)
    if (audioCtx.state === "suspended") {
      try { await audioCtx.resume(); } catch (e) { uiLog("resume() failed: " + e.message); }
    }

    // request mic (this will popup permission dialog if needed)
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sourceNode = audioCtx.createMediaStreamSource(micStream);

    analyser = audioCtx.createAnalyser();
    // sanity: ensure fftSize is power of two and within range
    analyser.fftSize = 4096;
    sourceNode.connect(analyser);

    running = true;
    if (startBtn) startBtn.textContent = "STOP";
    window.UKCOZY?.setStartPulsing?.(true);
    uiLog("Audio started (sampleRate: " + audioCtx.sampleRate + ")");

    renderLoop();
  } catch (err) {
    uiLog("Mic error: " + (err && err.message ? err.message : String(err)));
  }
}

/* ----------------------------
   Stop audio
   ---------------------------- */
function stop() {
  if (!running) return;
  running = false;
  if (startBtn) startBtn.textContent = "START";
  window.UKCOZY?.setStartPulsing?.(false);
  try {
    micStream?.getTracks().forEach(t => t.stop());
    if (audioCtx && audioCtx.state !== "closed") audioCtx.close();
  } catch (e) { uiLog("Stop error: " + e.message); }
  uiLog("Audio stopped");
}

if (startBtn) startBtn.addEventListener("click", () => (running ? stop() : start()));

/* ----------------------------
   Buffers
   ---------------------------- */
const timeBuf = new Float32Array(4096);

/* ----------------------------
   Draw helpers
   ---------------------------- */
function drawSpectrogramColumn(mag) {
  if (!spCtx || !spectroCanvas) return;
  const w = spectroCanvas.width, h = spectroCanvas.height;
  if (w <= 1 || h <= 1) return;

  // shift left
  const img = spCtx.getImageData(1, 0, w - 1, h);
  spCtx.putImageData(img, 0, 0);

  const col = spCtx.createImageData(1, h);
  for (let y = 0; y < h; y++) {
    const idx = Math.floor((y / h) * mag.length);
    const v = Math.min(Math.max(Math.log1p(Math.abs(mag[idx] || 0)) * 60, 0), 255);
    col.data[(h - 1 - y) * 4 + 0] = v;
    col.data[(h - 1 - y) * 4 + 1] = Math.floor(v * 0.6);
    col.data[(h - 1 - y) * 4 + 2] = Math.floor(v * 0.4);
    col.data[(h - 1 - y) * 4 + 3] = 255;
  }
  spCtx.putImageData(col, w - 1, 0);
}

function drawChromaBars(chroma) {
  if (!chCtx || !chromaCanvas) return;
  const w = chromaCanvas.width, h = chromaCanvas.height;
  const bw = w / 12;
  chCtx.clearRect(0, 0, w, h);
  const labels = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  for (let i = 0; i < 12; i++) {
    const hh = (chroma[i] || 0) * h;
    chCtx.fillStyle = `hsl(${i * 30}, 70%, 55%)`;
    chCtx.fillRect(i * bw + 3, h - hh, bw - 6, hh);
    chCtx.fillStyle = "#333";
    chCtx.font = "10px monospace";
    chCtx.fillText(labels[i], i * bw + bw / 2 - 8, h - 4);
  }
}

/* ----------------------------
   FFT -> freq estimate helper
   ---------------------------- */
function estimateFreqFromFFT(mag, sampleRate, fftSize, centerFreq, windowHz = 20) {
  if (!mag || mag.length === 0) return -1;
  const binSize = sampleRate / fftSize;
  const centerBin = Math.round(centerFreq / binSize);
  const half = Math.max(1, Math.round(windowHz / binSize));

  let maxIdx = -1, maxVal = -Infinity;
  const lo = Math.max(0, centerBin - half);
  const hi = Math.min(mag.length - 1, centerBin + half);
  for (let b = lo; b <= hi; b++) {
    const v = mag[b] || 0;
    if (v > maxVal) { maxVal = v; maxIdx = b; }
  }
  if (maxIdx < 0) return -1;

  const left = mag[maxIdx - 1] || 0;
  const center = mag[maxIdx] || 0;
  const right = mag[maxIdx + 1] || 0;
  const denom = (left - 2 * center + right);
  const p = denom === 0 ? 0 : 0.5 * (left - right) / denom;
  return (maxIdx + p) * binSize;
}

/* ----------------------------
   Main processing
   ---------------------------- */
function processAudio() {
  if (!analyser || !audioCtx) return;

  try {
    analyser.getFloatTimeDomainData(timeBuf);
  } catch (e) {
    uiLog("Time domain read error: " + e.message);
    return;
  }

  // FFT (dB values)
  const bins = analyser.frequencyBinCount;
  const freqBins = new Float32Array(bins);
  try {
    analyser.getFloatFrequencyData(freqBins);
  } catch (e) {
    uiLog("Frequency read error: " + e.message);
    return;
  }

  // convert dB -> linear magnitude. dB is negative; use /20
  const mag = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    const db = freqBins[i];
    // if db is -Infinity, skip
    if (!isFinite(db)) { mag[i] = 0; continue; }
    mag[i] = Math.pow(10, db / 20); // correct conversion
  }

  // TUNER (per string) - only if in mode
  if (!modeSelect || modeSelect.value !== "chord") {
    const strings = [
      { freq: 392.0, needle: needleG, out: freqG },
      { freq: 261.63, needle: needleC, out: freqC },
      { freq: 329.63, needle: needleE, out: freqE },
      { freq: 440.0, needle: needleA, out: freqA },
    ];
    for (const s of strings) {
      if (!s.needle || !s.out) continue;
      const f = estimateFreqFromFFT(mag, audioCtx.sampleRate, analyser.fftSize, s.freq);
      if (f <= 0 || !isFinite(f)) {
        s.out.textContent = "- Hz";
        s.needle.style.left = "50%";
      } else {
        s.out.textContent = f.toFixed(1) + " Hz";
        const diff = f - s.freq;
        const px = 50 + Math.max(-45, Math.min(45, diff * 6));
        s.needle.style.left = px + "%";
      }
    }
  }

  // CHROMA & CHORD
  const chroma = computeChroma(mag, audioCtx.sampleRate, analyser.fftSize);
  drawChromaBars(chroma);

  if (!modeSelect || modeSelect.value !== "tuner") {
    const chord = detectChordFromChroma(chroma);
    const threshold = (chromaThresh && chromaThresh.valueAsNumber) ? chromaThresh.valueAsNumber / 100 : 0.5;
    if (chord && chord.score >= threshold) {
      if (chordLabel) {
        chordLabel.textContent = chord.chord;
        chordLabel.style.color = chord.chord.endsWith("m") ? "#8C5E62" : "#FF7F73";
      }
    } else {
      if (chordLabel) { chordLabel.textContent = "--"; chordLabel.style.color = "#555"; }
    }
    if (chordScore) chordScore.textContent = `Score: ${chord ? chord.score.toFixed(2) : "0.00"}`;
  }

  // Spectrogram
  drawSpectrogramColumn(mag);
}

/* ----------------------------
   Animation loop
   ---------------------------- */
function renderLoop() {
  if (!running) return;
  requestAnimationFrame(renderLoop);
  processAudio();
}

/* ----------------------------
   Keyboard shortcut
   ---------------------------- */
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    running ? stop() : start();
  }
});

/* ----------------------------
   Expose start/stop for debug
   ---------------------------- */
window.UKCOZY = window.UKCOZY || {};
window.UKCOZY.start = start;
window.UKCOZY.stop = stop;
