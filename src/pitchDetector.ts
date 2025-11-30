export function detectPitch(buf: Float32Array, sampleRate: number): number {
    let SIZE = buf.length;
    let maxSamples = Math.floor(SIZE / 2);
    let bestOffset = -1;
    let bestCorrelation = 0;

    for (let offset = 8; offset < maxSamples; offset++) {
        let correlation = 0;

        for (let i = 0; i < maxSamples; i++) {
            correlation += Math.abs((buf[i]) - (buf[i + offset]));
        }

        correlation = 1 - (correlation / maxSamples);

        if (correlation > bestCorrelation) {
            bestCorrelation = correlation;
            bestOffset = offset;
        }
    }

    if (bestCorrelation > 0.9 && bestOffset !== -1) {
        return sampleRate / bestOffset;
    }

    return -1;
}
