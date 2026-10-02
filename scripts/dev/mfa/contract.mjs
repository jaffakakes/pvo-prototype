const LIMIT_AUDIO_BYTES = 1_920_128;
export const MAX_BODY_BYTES = 2_570_000;

export class AlignmentError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function reject() {
  throw new AlignmentError(422, "invalid_alignment_input");
}

export function parseAlignmentInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).sort().join() !== "audio,duration,language,text") reject();
  const { audio, duration, text, language } = input;
  if (language !== "en" || typeof text !== "string" || !text.trim() || text.length > 4000
      || /[\u0000-\u0008\u000b-\u001f]/u.test(text)
      || !Number.isFinite(duration) || duration <= 0 || duration > 60
      || typeof audio !== "string" || audio.length > Math.ceil(LIMIT_AUDIO_BYTES / 3) * 4
      || audio.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(audio)) reject();
  const words = normalizedAlignmentWords(text);
  if (!words.length || words.length > 300) reject();
  const wav = Buffer.from(audio, "base64");
  if (wav.toString("base64") !== audio || wav.length < 44 || wav.length > LIMIT_AUDIO_BYTES || wav.toString("ascii", 0, 4) !== "RIFF"
      || wav.toString("ascii", 8, 12) !== "WAVE" || wav.readUInt32LE(4) + 8 !== wav.length) reject();
  let format;
  let pcm;
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > wav.length) reject();
    if (id === "fmt ") {
      if (format || length < 16) reject();
      format = wav.subarray(start, start + length);
    }
    if (id === "data") {
      if (pcm || length % 2) reject();
      pcm = wav.subarray(start, start + length);
    }
    offset = start + length + (length % 2);
    if (offset > wav.length) reject();
  }
  if (offset !== wav.length || !format || !pcm || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1
      || format.readUInt32LE(4) !== 16000 || format.readUInt32LE(8) !== 32000
      || format.readUInt16LE(12) !== 2 || format.readUInt16LE(14) !== 16
      || pcm.length / 32000 > 60 || Math.abs(pcm.length / 32000 - duration) > 0.002) reject();
  let energy = 0;
  for (let index = 0; index < pcm.length; index += 2) energy += pcm.readInt16LE(index) ** 2;
  if (!pcm.length || Math.sqrt(energy / (pcm.length / 2)) < 1) {
    throw new AlignmentError(422, "alignment_silent_audio");
  }
  return { audio, duration: pcm.length / 32000, text: text.trim(), language };
}

export function parseAlignmentOutput(output, input) {
  const fail = () => { throw new AlignmentError(422, "alignment_incomplete"); };
  const provenance = output?.provenance;
  if (!provenance || provenance.version !== "3.4.2+pvo.refinement.1" || provenance.refined !== true
      || provenance.acousticModel !== "english_mfa@3.1.0"
      || provenance.dictionary !== "english_mfa") fail();
  try { return parseWordAlignment(output, input); } catch { return fail(); }
}
import { normalizedAlignmentWords, parseWordAlignment } from "../../../packages/pvo-assistant/native/index.js";
