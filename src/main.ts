import { detectPitch } from "./pitchDetector.js";
import { matchUkuleleString } from "./tuner.js";

const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const freqEl = document.getElementById("freq")!;
const noteEl = document.getElementById("note")!;
const statusEl = document.getElementById("status")!;

let audioCtx: AudioContext;
let analyser: AnalyserNode;
let buffer: Float32Array;

startBtn.onclick = async () => {
    audioCtx = new AudioContext();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;

    source.connect(analyser);

    buffer = new Float32Array(analyser.fftSize);
    updatePitch();
};

function updatePitch() {
    analyser.getFloatTimeDomainData(buffer);

    const freq = detectPitch(buffer, audioCtx.sampleRate);

    if (freq !== -1) {
        freqEl.textContent = freq.toFixed(2);

        const match = matchUkuleleString(freq);
        noteEl.textContent = match.name;

        const diff = freq - match.freq;

        if (Math.abs(diff) < 3) statusEl.textContent = "✔ Perfect";
        else if (diff > 0) statusEl.textContent = "▲ Too High";
        else statusEl.textContent = "▼ Too Low";
    }

    requestAnimationFrame(updatePitch);
}
