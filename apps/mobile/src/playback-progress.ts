export function playbackProgress(samples: number, sampleRateHz: number, prerollMs: number) {
  const processedMs = samples / sampleRateHz * 1000;
  return {
    remainingMs: Math.max(0, Math.ceil(prerollMs - processedMs)),
    elapsedSeconds: Math.max(0, (processedMs - prerollMs) / 1000),
  };
}
