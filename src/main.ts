import { detectPitch } from "./pitchDetector.js";
import { nearestString, detectChordFromChroma } from "./tuner.js";

// DOM refs
const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const chordLabel = document.getElementById("chordLabel")!;
const chordScore = document.getElementById("chordScore")!;
const spectroCanvas = document.getElementById("spectroCanvas") as HTMLCanvasElement;
const chromaCanvas = document.getElementById("chromaCanvas") as HTMLCanvasElement;
const needleG = document.getElementById("needleG")!;
const needleC = document.getElementById("needleC")!;
const needleE = document.getElementById("needleE")!;
const needleA = document.getElementById("needleA")!;
const freqG = document.getElementById("freqG")!;
const freqC = document.getElementById("freqC")!;
const freqE = document.getElementById("freqE")!;
const freqA = document.getElementById("freqA")!;
const logEl = document.getElementById("log")!;
const thresholdInput = document.getElementById("threshold") as HTMLInputElement;
const chromaThresh = document.getElementById("chromaThresh") as HTMLInputElement;
const modeSelect = document.getElementById("modeSelect") as HTMLSelectElement;

// audio
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let running = false;
let micStream: MediaStream | null = null;

function log(msg: string) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

// canvas contexts
const spCtx = spectroCanvas.getContext("2d")!;
const chCtx = chromaCanvas.getContext("2d")!;

function resizeCanvas() {
  spectroCanvas.width = spectroCanvas.clientWidth;
  spectroCanvas.height = spectroCanvas.clientHeight;
  chromaCanvas.width = chromaCanvas.clientWidth;
  chromaCanvas.height = chromaCanvas.clientHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// helpers: compute chroma from FFT magnitude
function computeChroma(mag: Float32Array, sampleRate: number, fftSize: number) {
  const chroma = new Array<number>(12).fill(0);
  // map bins to freq
  for (let i = 0; i < mag.length; i++) {
    const freq = i * (sampleRate / fftSize);
    if (freq < 60 || freq > 5000) continue;
    // convert to MIDI note number -> pitch class
    const midi = Math.round(12 * Math.log2(freq / 440) + 69);
    const pc = ((midi % 12) + 12) % 12;
    chroma[pc] += mag[i];
  }
  // normalize
  const max = Math.max(...chroma);
  if (max > 0) for (let i=0;i<12;i++) chroma[i] /= max;
  return chroma;
}

async function start() {
  if (running) return;
  try {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sourceNode = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 4096;
    sourceNode.connect(analyser);
    running = true;
    startBtn.textContent = "STOP";
    log("Audio started");
    renderLoop();
  } catch (err) {
    log("Error opening microphone: " + (err as any).message);
  }
}

function stop() {
  if (!running) return;
  running = false;
  startBtn.textContent = "START";
  try {
    micStream?.getTracks().forEach(t => t.stop());
    (audioCtx as AudioContext).close();
  } catch{}
  log("Audio stopped");
}

startBtn.addEventListener('click', () => {
  if (!running) start(); else stop();
});

// create buffers
const timeBuf = new Float32Array(4096);
const fftBuf = new Float32Array(2048);

function drawSpectrogram(mag: Float32Array) {
  const w = spectroCanvas.width, h = spectroCanvas.height;
  // shift left
  const img = spCtx.getImageData(1,0,w-1,h);
  spCtx.putImageData(img,0,0);
  // draw new column at right
  const column = spCtx.createImageData(1,h);
  for (let y=0;y<h;y++){
    // map y to bin range
    const idx = Math.floor((y/h) * mag.length);
    const v = Math.min(Math.max(Math.log1p(mag[idx])*10,0),1);
    const r = Math.floor(255*v), g = Math.floor(200*v), b=100;
    column.data[(h-1-y)*4 + 0] = r;
    column.data[(h-1-y)*4 + 1] = g;
    column.data[(h-1-y)*4 + 2] = b;
    column.data[(h-1-y)*4 + 3] = 255;
  }
  spCtx.putImageData(column, w-1, 0);
}

function drawChromaBars(chroma: number[]) {
  const w = chromaCanvas.width, h = chromaCanvas.height;
  chCtx.clearRect(0,0,w,h);
  const bw = w / 12;
  for (let i=0;i<12;i++){
    const hh = chroma[i] * h;
    chCtx.fillStyle = `hsl(${i*30},80%,50%)`;
    chCtx.fillRect(i*bw + 4, h - hh, bw - 8, hh);
    chCtx.fillStyle = '#222';
    chCtx.font = '10px monospace';
    const labels = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    chCtx.fillText(labels[i], i*bw + bw/2 - 8, h - 4);
  }
}

// map frequencies for each string using detection algorithm (autocorrelation)
function processAudio() {
  if (!analyser || !audioCtx) return;
  analyser.getFloatTimeDomainData(timeBuf); // time domain sample
  // pitch detection
  const freq = detectPitch(timeBuf, audioCtx!.sampleRate);

  // fill fft magnitude for chroma & spectro
  const fftSize = analyser.fftSize;
  const freqBins = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(freqBins); // in dB
  // convert dB to linear magnitude
  const mag = new Float32Array(freqBins.length);
  for (let i = 0; i < freqBins.length; i++){
    mag[i] = Math.pow(10, freqBins[i] / 20);
  }

  // volume approx
  let vol = 0;
  for (let i=0;i<timeBuf.length;i++) vol += Math.abs(timeBuf[i]);
  vol = vol / timeBuf.length;

  // update tuner needles for each string by running small autocorrelation around expected freq
  const strings = [
    {id:'G', freq:392.00, needle: needleG, out: freqG},
    {id:'C', freq:261.63, needle: needleC, out: freqC},
    {id:'E', freq:329.63, needle: needleE, out: freqE},
    {id:'A', freq:440.00, needle: needleA, out: freqA}
  ];

  for (const s of strings){
    // coarse detection: zoom into freq band around s.freq using FFT bins
    let detected = estimateFreqFromFFT(mag, audioCtx!.sampleRate, analyser!.fftSize, s.freq, 20);
    if (detected < 0) {
      s.out.textContent = '- Hz';
      s.needle.style.left = '50%';
    } else {
      s.out.textContent = detected.toFixed(1) + ' Hz';
      // needle: map difference to left percentage (center=perfect)
      const diff = detected - s.freq; // positive = sharp
      const px = 50 + Math.max(-45, Math.min(45, diff * 6)); // scale
      s.needle.style.left = px + '%';
    }
  }

  // compute chroma & chord detection
  const chroma = computeChroma(mag, audioCtx!.sampleRate, analyser!.fftSize);
  drawChromaBars(chroma);
  const chromaRes = detectChordFromChroma(chroma);
  if (chromaRes.score > (chromaThresh.valueAsNumber / 100)) {
    chordLabel.textContent = chromaRes.chord;
    chordScore.textContent = `Score: ${chromaRes.score.toFixed(2)}`;
  } else {
    chordLabel.textContent = '--';
    chordScore.textContent = `Score: ${chromaRes.score.toFixed(2)}`;
  }

  // draw spectrogram
  drawSpectrogram(mag);
}

function estimateFreqFromFFT(mag: Float32Array, sampleRate: number, fftSize: number, centerFreq: number, windowHz = 20) {
  const binSize = sampleRate / fftSize;
  const centerBin = Math.round(centerFreq / binSize);
  const halfW = Math.round(windowHz / binSize);
  let maxIdx = -1, maxVal = 0;
  for (let b=Math.max(0,centerBin-halfW); b<=Math.min(mag.length-1,centerBin+halfW); b++){
    if (mag[b] > maxVal) { maxVal = mag[b]; maxIdx = b; }
  }
  if (maxIdx < 0) return -1;
  // parabolic interpolation for better freq estimate
  const alpha = mag[maxIdx-1] || 0;
  const beta = mag[maxIdx];
  const gamma = mag[maxIdx+1] || 0;
  const p = 0.5 * (alpha - gamma) / (alpha - 2*beta + gamma);
  return (maxIdx + p) * binSize;
}

// spectrogram rendering uses mag (linear)
function drawSpectrogram(mag: Float32Array) {
  const reduced = mag; // we draw using mag directly
  drawSpectrogramColumn(reduced);
}

function drawSpectrogramColumn(mag: Float32Array) {
  const w = spectroCanvas.width, h = spectroCanvas.height;
  // copy left
  const image = spCtx.getImageData(1,0,w-1,h);
  spCtx.putImageData(image,0,0);
  // new column
  const col = spCtx.createImageData(1,h);
  for (let y=0;y<h;y++){
    const idx = Math.floor(y/h * mag.length);
    const v = Math.min(Math.log1p(mag[idx]) * 60, 255);
    col.data[(h-1-y)*4+0] = v; // r
    col.data[(h-1-y)*4+1] = Math.floor(v*0.6);
    col.data[(h-1-y)*4+2] = Math.floor(v*0.4);
    col.data[(h-1-y)*4+3] = 255;
  }
  spCtx.putImageData(col, w-1, 0);
}

function renderLoop() {
  if (!running) return;
  requestAnimationFrame(renderLoop);
  if (audioCtx && analyser) {
    processAudio();
  }
}

function estimateChromaThreshold(): number {
  return chromaThresh.valueAsNumber / 100;
}

// keyboard shortcut: space
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (!running) start(); else stop();
  }
});
