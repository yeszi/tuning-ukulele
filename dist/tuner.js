// standard ukulele tuning (G4 C4 E4 A4)
export const UKULELE_STRINGS = [
    { name: "G4", freq: 392.00 },
    { name: "C4", freq: 261.63 },
    { name: "E4", freq: 329.63 },
    { name: "A4", freq: 440.00 }
];
// chord templates like earlier (PCP binary)
export const CHORD_TEMPLATES = {
    C: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
    D: [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0],
    E: [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
    F: [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
    G: [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1],
    A: [0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
    B: [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1],
    Am: [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
    Dm: [0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0],
    Em: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1],
};
export function nearestString(freq) {
    let best = UKULELE_STRINGS[0];
    let bestDiff = Math.abs(freq - best.freq);
    for (const s of UKULELE_STRINGS) {
        const d = Math.abs(freq - s.freq);
        if (d < bestDiff) {
            best = s;
            bestDiff = d;
        }
    }
    return { string: best, diff: freq - best.freq };
}
export function detectChordFromChroma(chroma, templates = CHORD_TEMPLATES) {
    let best = { chord: "--", score: 0 };
    const chrNorm = Math.sqrt(chroma.reduce((a, b) => a + b * b, 0));
    for (const [k, tmpl] of Object.entries(templates)) {
        let dot = 0, tmplNorm = 0;
        for (let i = 0; i < 12; i++) {
            dot += chroma[i] * tmpl[i];
            tmplNorm += tmpl[i] * tmpl[i];
        }
        const score = dot / (Math.sqrt(tmplNorm) * chrNorm + 1e-9);
        if (score > best.score) {
            best = { chord: k, score };
        }
    }
    return best;
}
//# sourceMappingURL=tuner.js.map