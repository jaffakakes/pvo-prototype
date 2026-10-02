/** One normalization contract for requested speech and aligner word labels. */
export function normalizedAlignmentWords(text) {
  return text.normalize("NFKC").replace(/[’‘]/g, "'").toLowerCase()
    .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
}

/** Forced alignment verifies intervals, never whether its supplied transcript is true. */
export function parseWordAlignment(value, { text, duration }) {
  const invalid = () => new Error("Word alignment is incomplete or invalid. Check the transcript and source range.");
  if (typeof text !== "string" || text.length > 4000 || !Number.isFinite(duration)
    || duration <= 0 || duration > 60) throw invalid();
  const expected = normalizedAlignmentWords(text);
  if (!expected.length || expected.length > 300 || !value || typeof value !== "object"
    || typeof value.text !== "string" || value.text.length > 4000
    || JSON.stringify(normalizedAlignmentWords(value.text)) !== JSON.stringify(expected)
    || !Array.isArray(value.words) || value.words.length !== expected.length) throw invalid();
  let previous = 0;
  const words = value.words.map((word, index) => {
    if (!word || typeof word.text !== "string" || word.text.length > 200
      || JSON.stringify(normalizedAlignmentWords(word.text)) !== JSON.stringify([expected[index]])
      || !Number.isFinite(word.start) || !Number.isFinite(word.end)
      || word.start < 0 || word.start >= duration || word.start < previous - 0.000001
      || word.end <= word.start || word.end > duration + 0.000001) throw invalid();
    previous = word.end;
    return { text: word.text, start: word.start, end: Math.min(word.end, duration) };
  });
  const p = value.provenance;
  if (!p || p.method !== "forced_alignment" || p.engine !== "mfa" || p.language !== "en"
    || p.transcriptVerified !== false || typeof p.refined !== "boolean"
    || ["version", "acousticModel", "dictionary"].some(key =>
      typeof p[key] !== "string" || !p[key].trim() || p[key].length > 200)) throw invalid();
  return { text, words, provenance: {
    method: p.method, engine: p.engine, language: p.language, transcriptVerified: false,
    version: p.version, acousticModel: p.acousticModel, dictionary: p.dictionary, refined: p.refined,
  } };
}
