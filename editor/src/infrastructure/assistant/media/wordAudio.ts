import type { WordTimingSource } from "../../../domain/assistant/wordTiming";
import { loadAssistantAudioSource } from "./audioSource";
import { cancellable } from "./lifecycle";
import { monoWav } from "./wav";

const SAMPLE_RATE = 16000;

/** Align the original source voice: timeline speed must never pitch-shift this audio. */
export async function extractWordTimingAudio(
  source: WordTimingSource,
  { signal, fetch: send = fetch }: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<ArrayBuffer> {
  signal?.throwIfAborted();
  if (typeof OfflineAudioContext === "undefined") throw new Error("This browser cannot decode audio for word timing.");
  const duration = source.sourceEnd - source.sourceStart;
  const audio = new OfflineAudioContext(1, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const loaded = await loadAssistantAudioSource(audio, source, { signal, fetch: send });
  signal?.throwIfAborted();
  if (source.sourceEnd > loaded.buffer.duration + 1 / SAMPLE_RATE)
    throw new Error("The selected source audio ends before this timing range. Choose a shorter range.");
  const node = audio.createBufferSource();
  let started = false;
  try {
    node.buffer = loaded.buffer;
    node.playbackRate.value = 1;
    node.connect(audio.destination);
    node.start(0, source.sourceStart, duration);
    started = true;
    const rendered = await cancellable(audio.startRendering(), signal);
    signal?.throwIfAborted();
    return monoWav(rendered.getChannelData(0), SAMPLE_RATE);
  } finally {
    if (started) node.stop();
    node.disconnect();
    node.buffer = null;
  }
}
