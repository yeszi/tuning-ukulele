import { detectPitch } from "./pitchDetector.js";
import { detectChordFromChroma } from "./tuner.js";

/* --------------------------------------------------
    DOM References
-------------------------------------------------- */
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

// logging UI
const logEl = document.getElementById("log");
const log = (msg) => {
    if (window?.UKCOZY?.log) {
        window.UKCOZY.log(msg);
    } else {
        const t = new Date().toLocaleTimeString();
        logEl.textContent += `[${t}] ${msg}\n`;
        logEl.scrollTop = logEl.scrollHeight;
    }
};

/* --------------------------------------------------
    Audio
-------------------------------------------------- */
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let micStream = null;
let running = false;

/* --------------------------------------------------
    Canvas Setup
-------------------------------------------------- */
const spCtx = spectroCanvas.getContext("2d");
const chCtx = chromaCanvas.getContext("2d");

function resizeCanvas() {
    spectroCanvas.width = spectroCanvas.clientWidth;
    spectroCanvas.height = spectroCanvas.clientHeight;
    chromaCanvas.width = chromaCanvas.clientWidth;
    chromaCanvas.height = chromaCanvas.clientHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

/* --------------------------------------------------
    Compute Chroma
-------------------------------------------------- */
function computeChroma(mag, sampleRate, fftSize) {
    const chroma = Array(12).fill(0);

    for (let i = 0; i < mag.length; i++) {
        const freq = i * (sampleRate / fftSize);
        if (freq < 60 || freq > 5000) continue;

        const midi = Math.round(12 * Math.log2(freq / 440) + 69);
        const pc = ((midi % 12) + 12) % 12;
        chroma[pc] += mag[i];
    }

    const max = Math.max(...chroma);
    if (max > 0) {
        for (let i = 0; i < 12; i++) chroma[i] /= max;
    }

    return chroma;
}

/* --------------------------------------------------
    Start Audio
-------------------------------------------------- */
async function start() {
    if (running) return;

    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        await audioCtx.resume();

        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        sourceNode = audioCtx.createMediaStreamSource(micStream);

        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 4096;

        sourceNode.connect(analyser);
        running = true;

        startBtn.textContent = "STOP";
        window.UKCOZY?.setStartPulsing(true);

        log("Audio started");
        renderLoop();

    } catch (err) {
        log("Mic error: " + err.message);
    }
}

/* --------------------------------------------------
    Stop Audio
-------------------------------------------------- */
function stop() {
    if (!running) return;

    running = false;
    startBtn.textContent = "START";
    window.UKCOZY?.setStartPulsing(false);

    try {
        micStream?.getTracks().forEach(t => t.stop());
        audioCtx.close();
    } catch {}

    log("Audio stopped");
}

startBtn.addEventListener("click", () => (!running ? start() : stop()));

/* --------------------------------------------------
    Visualizer buffers
-------------------------------------------------- */
const timeBuf = new Float32Array(4096);

/* --------------------------------------------------
    Draw Spectrogram
-------------------------------------------------- */
function drawSpectrogramColumn(mag) {
    const w = spectroCanvas.width;
    const h = spectroCanvas.height;

    const image = spCtx.getImageData(1, 0, w - 1, h);
    spCtx.putImageData(image, 0, 0);

    const col = spCtx.createImageData(1, h);
    for (let y = 0; y < h; y++) {
        const idx = Math.floor((y / h) * mag.length);
        const v = Math.min(Math.log1p(mag[idx]) * 60, 255);

        col.data[(h - 1 - y) * 4 + 0] = v;
        col.data[(h - 1 - y) * 4 + 1] = v * 0.7;
        col.data[(h - 1 - y) * 4 + 2] = v * 0.5;
        col.data[(h - 1 - y) * 4 + 3] = 255;
    }
    spCtx.putImageData(col, w - 1, 0);
}

/* --------------------------------------------------
    Draw Chroma Bars
-------------------------------------------------- */
function drawChromaBars(chroma) {
    const w = chromaCanvas.width;
    const h = chromaCanvas.height;
    const bw = w / 12;

    chCtx.clearRect(0, 0, w, h);
    const labels = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    for (let i = 0; i < 12; i++) {
        const hh = chroma[i] * h;
        chCtx.fillStyle = `hsl(${i * 30}, 80%, 55%)`;
        chCtx.fillRect(i * bw + 3, h - hh, bw - 6, hh);

        chCtx.fillStyle = "#333";
        chCtx.font = "10px monospace";
        chCtx.fillText(labels[i], i * bw + bw / 2 - 8, h - 4);
    }
}

/* --------------------------------------------------
    Estimate frequency for tuning
-------------------------------------------------- */
function estimateFreqFromFFT(mag, sampleRate, fftSize, centerFreq, windowHz = 20) {
    const binSize = sampleRate / fftSize;
    const centerBin = Math.round(centerFreq / binSize);
    const half = Math.round(windowHz / binSize);

    let max = 0;
    let maxIdx = -1;

    for (let b = centerBin - half; b <= centerBin + half; b++) {
        if (b < 0 || b >= mag.length) continue;
        if (mag[b] > max) {
            max = mag[b];
            maxIdx = b;
        }
    }

    if (maxIdx < 0) return -1;

    // parabolic peak interpolation
    const a = mag[maxIdx - 1] || 0;
    const b = mag[maxIdx];
    const c = mag[maxIdx + 1] || 0;
    const p = 0.5 * (a - c) / (a - 2 * b + c);

    return (maxIdx + p) * binSize;
}

/* --------------------------------------------------
    Main Audio Processing
-------------------------------------------------- */
function processAudio() {
    if (!analyser || !audioCtx) return;

    /* ---- 1. Time domain ---- */
    analyser.getFloatTimeDomainData(timeBuf);
    // pitch not used directly because we use FFT for strings

    /* ---- 2. FFT ---- */
    const freqBins = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(freqBins);

    const mag = new Float32Array(freqBins.length);
    for (let i = 0; i < freqBins.length; i++)
        mag[i] = Math.pow(10, freqBins[i] / -20);

    /* ---- 3. Tuner ---- */
    if (modeSelect.value !== "chord") {
        const strings = [
            { freq: 392.0, needle: needleG, out: freqG },
            { freq: 261.63, needle: needleC, out: freqC },
            { freq: 329.63, needle: needleE, out: freqE },
            { freq: 440.0, needle: needleA, out: freqA },
        ];

        for (let s of strings) {
            let f = estimateFreqFromFFT(mag, audioCtx.sampleRate, analyser.fftSize, s.freq);
            if (f < 0) {
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

    /* ---- 4. Chroma ---- */
    const chroma = computeChroma(mag, audioCtx.sampleRate, analyser.fftSize);
    drawChromaBars(chroma);

    /* ---- 5. Chord detection ---- */
    if (modeSelect.value !== "tuner") {
        const chord = detectChordFromChroma(chroma);
        const threshold = chromaThresh.valueAsNumber / 100;

        if (chord.score >= threshold) {
            chordLabel.textContent = chord.chord;
            chordLabel.style.color = chord.chord.endsWith("m") ? "#8C5E62" : "#FF7F73";
        } else {
            chordLabel.textContent = "--";
            chordLabel.style.color = "#555";
        }
        chordScore.textContent = `Score: ${chord.score.toFixed(2)}`;
    }

    /* ---- 6. Spectrogram ---- */
    drawSpectrogramColumn(mag);
}

/* --------------------------------------------------
    Animation Loop
-------------------------------------------------- */
function renderLoop() {
    if (!running) return;
    requestAnimationFrame(renderLoop);
    processAudio();
}

/* --------------------------------------------------
    Keyboard Shortcut
-------------------------------------------------- */
window.addEventListener("keydown", e => {
    if (e.code === "Space") {
        e.preventDefault();
        running ? stop() : start();
    }
});
