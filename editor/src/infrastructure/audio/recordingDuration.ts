/** Decode the recorded container: MediaRecorder metadata may report an infinite duration. */
export async function recordingDuration(
  blob: Blob,
  signal: AbortSignal,
): Promise<number> {
  signal.throwIfAborted();
  const decoder = new OfflineAudioContext(1, 1, 44100);
  const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
  signal.throwIfAborted();
  if (!Number.isFinite(decoded.duration) || decoded.duration < 0.1)
    throw new Error("The voiceover recording has no usable audio.");
  return decoded.duration;
}
