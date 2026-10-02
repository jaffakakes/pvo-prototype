import { normalizedAlignmentWords, parseWordAlignment } from "../../../packages/pvo-assistant/native/index.js";

const EPSILON = 0.000001;

/** Check source identities and arithmetic again at the untrusted HTTP boundary. */
export function validateWordTiming(scene, timing, observed = false) {
  const sources = [
    ...scene.clips.map(source => ({ source, kind: "clip",
      audible: !scene.muted && !source.audioDetached && scene.clipGain > 0 })),
    ...scene.audioClips.map(source => ({ source, kind: "audio", audible: !source.muted && source.gain > 0 })),
  ];
  const matches = sources.filter(item => item.kind === timing.source.kind && item.source.id === timing.source.id);
  if (matches.length !== 1) throw new Error("Word timing must fit inside one existing source.");
  const selected = matches[0];
  const source = selected.source;
  if (timing.start < source.start - EPSILON || timing.end > source.end + EPSILON
    || timing.end <= timing.start || source.speed <= 0)
    throw new Error("Word timing must fit inside one existing source.");
  if (!selected.audible || (selected.kind === "clip" && !source.hasMedia))
    throw new Error("Word timing requires audible media from the selected source.");
  if (sources.some(item => item !== selected && item.audible
    && item.source.start < timing.end && item.source.end > timing.start))
    throw new Error("Word timing cannot inspect overlapping audible sources. Choose an unambiguous range.");
  const sourceStart = Math.max(source.sourceIn, source.sourceIn + (timing.start - source.start) * source.speed);
  const sourceEnd = Math.min(source.sourceOut, source.sourceIn + (timing.end - source.start) * source.speed);
  const duration = sourceEnd - sourceStart;
  if (sourceStart < source.sourceIn - EPSILON || sourceEnd > source.sourceOut + EPSILON
    || duration <= 0 || duration > 60)
    throw new Error("Align at most 60 seconds of original-speed source audio.");
  const tokens = normalizedAlignmentWords(timing.text);
  if (!tokens.length || tokens.length > 300) throw new Error("Supply a complete transcript of at most 300 words.");
  if (!observed) return;
  if (Math.abs(timing.sourceStart - sourceStart) > EPSILON || Math.abs(timing.sourceEnd - sourceEnd) > EPSILON)
    throw new Error("Word timing refers to a different source range.");
  for (const word of timing.words) {
    const mappedStart = source.start + (word.sourceStart - source.sourceIn) / source.speed;
    const mappedEnd = source.start + (word.sourceEnd - source.sourceIn) / source.speed;
    if (Math.abs(mappedStart - word.start) > EPSILON || Math.abs(mappedEnd - word.end) > EPSILON)
      throw new Error("Word source and scene timestamps do not agree.");
  }
  parseWordAlignment({ text: timing.text, provenance: timing.provenance,
    words: timing.words.map(word => ({ text: word.text,
      start: word.sourceStart - sourceStart, end: word.sourceEnd - sourceStart })) },
  { text: timing.text, duration });
}
