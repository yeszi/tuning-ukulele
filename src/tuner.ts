export type UkuleleString = {
    name: string;
    freq: number;
};

export const ukuleleNotes: UkuleleString[] = [
    { name: "G4", freq: 392.00 },
    { name: "C4", freq: 261.63 },
    { name: "E4", freq: 329.63 },
    { name: "A4", freq: 440.00 }
];

export function matchUkuleleString(freq: number) {
    let best = ukuleleNotes[0];
    let diff = Math.abs(freq - best.freq);

    for (let note of ukuleleNotes) {
        let d = Math.abs(freq - note.freq);
        if (d < diff) {
            best = note;
            diff = d;
        }
    }

    return best;
}
