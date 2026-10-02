import { inspectionAudio, inspectionScene, type InspectionProject, type TranscriptRequest } from "../../../domain/assistant/mediaInspection";
import { cancellable } from "./lifecycle";
import { loadAssistantAudioSource, MAX_AUDIO_SOURCE_SECONDS } from "./audioSource";
import { monoWav } from "./wav";

const SAMPLE_RATE = 16000;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/** Mix only authored speech-bearing media. Synthesized background music is not transcribed. */
export async function extractAssistantAudio(
  project: InspectionProject,
  request: TranscriptRequest,
  { signal, fetch: send = fetch }: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<ArrayBuffer | null> {
  signal?.throwIfAborted();
  const scene = inspectionScene(project, request);
  const samples = inspectionAudio(scene, request);
  if (!samples.length) return null;
  if (typeof OfflineAudioContext === "undefined") throw new Error("This browser cannot decode audio for transcription.");
  const length = Math.ceil((request.end - request.start) * SAMPLE_RATE);
  const audio = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const buffers = new Map<string, AudioBuffer>();
  const sources: AudioBufferSourceNode[] = [];
  const started = new Set<AudioBufferSourceNode>();
  const gains: GainNode[] = [];
  let bytesRead = 0;
  try {
    for (const sample of samples) {
      signal?.throwIfAborted();
      if (sample.sourceDuration > MAX_AUDIO_SOURCE_SECONDS)
        throw new Error("This source is too long for browser transcription. Import a source under ten minutes.");
      let buffer = buffers.get(sample.url);
      if (!buffer) {
        const loaded = await loadAssistantAudioSource(audio, sample, {
          signal, fetch: send, remainingBytes: MAX_TOTAL_BYTES - bytesRead,
        });
        bytesRead += loaded.byteLength;
        buffer = loaded.buffer;
        buffers.set(sample.url, buffer);
      }
      signal?.throwIfAborted();
      // A video's audio track can end before its picture. Match media playback:
      // mix the decoded overlap and leave the remaining scene interval silent.
      const sourceLength = Math.min(sample.duration * sample.speed, buffer.duration - sample.sourceStart);
      if (sourceLength <= 0) continue;
      const source = audio.createBufferSource();
      sources.push(source);
      source.buffer = buffer;
      source.playbackRate.value = sample.speed;
      const gain = audio.createGain();
      gains.push(gain);
      gain.gain.value = sample.gain;
      source.connect(gain).connect(audio.destination);
      source.start(sample.offset, sample.sourceStart, sourceLength);
      started.add(source);
    }
    if (!sources.length) return null;
    const rendered = await cancellable(audio.startRendering(), signal);
    signal?.throwIfAborted();
    return monoWav(rendered.getChannelData(0), SAMPLE_RATE);
  } finally {
    for (const source of sources) {
      if (started.has(source)) source.stop();
      source.disconnect();
      source.buffer = null;
    }
    for (const gain of gains) gain.disconnect();
    buffers.clear();
  }
}
