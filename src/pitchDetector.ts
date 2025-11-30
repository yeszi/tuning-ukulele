export function detectPitch(buf: Float32Array, sampleRate: number): number {
  // Auto-correlation method
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i]*buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  let bestOffset = -1;
  let bestCorrelation = 0;
  let correlations = new Float32Array(SIZE);

  for (let offset = 2; offset < SIZE/2; offset++) {
    let c = 0;
    for (let i = 0; i < SIZE/2; i++) c += Math.abs(buf[i] - buf[i+offset]);
    correlations[offset] = 1 - (c / (SIZE/2));
    if (correlations[offset] > bestCorrelation) {
      bestCorrelation = correlations[offset];
      bestOffset = offset;
    }
  }
  if (bestCorrelation > 0.9 && bestOffset > 0) {
    return sampleRate / bestOffset;
  }
  return -1;
}
