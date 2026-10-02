import { HttpError } from "../../http.js";
import { withAssistantDeadline } from "../deadline.js";
import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, parseTranscriptionResult } from "./audio.js";
import { requestRunpodJson } from "./runpodHttp.js";

const TRANSCRIPTION_DEADLINE_MS = 90000;
const RESPONSE_BYTES = 256 * 1024;
const terminalStates = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const invalidTranscript = () => new HttpError(422, "The assistant could not produce a valid transcript. Try a shorter range.");

export function runpodTranscriptionConfigured(env) {
  return typeof env.RUNPOD_API_KEY === "string" && Boolean(env.RUNPOD_API_KEY.trim())
    && typeof env.RUNPOD_TRANSCRIPTION_ENDPOINT === "string"
    && /^[A-Za-z0-9_-]{1,100}$/.test(env.RUNPOD_TRANSCRIPTION_ENDPOINT);
}

/** Incomplete alignments keep the original segment; supplied invalid times never become fallback data. */
function alignedWordSegments(segment, duration) {
  if (segment.words === undefined) return null;
  if (!Array.isArray(segment.words)) throw invalidTranscript();
  let complete = segment.words.length > 0;
  const words = [];
  for (const word of segment.words) {
    if (!word || typeof word !== "object" || typeof word.word !== "string" || word.word.length > 2000)
      throw invalidTranscript();
    const hasStart = Object.hasOwn(word, "start");
    const hasEnd = Object.hasOwn(word, "end");
    if ((hasStart && (!Number.isFinite(word.start) || word.start < 0 || word.start > duration))
      || (hasEnd && (!Number.isFinite(word.end) || word.end < 0 || word.end > duration + 0.05))
      || (hasStart && hasEnd && word.end < word.start)) throw invalidTranscript();
    if (!hasStart || !hasEnd) complete = false;
    else words.push({ start: word.start, end: Math.min(word.end, duration), text: word.word });
  }
  return complete ? words : null;
}

/** WhisperX returns segments, not a top-level transcript; never accept its error object as success. */
export function parseRunpodTranscriptionOutput(output, duration) {
  if (!output || typeof output !== "object" || output.error !== undefined
    || !Array.isArray(output.segments) || output.segments.length > 300) throw invalidTranscript();
  let text = "";
  for (const segment of output.segments) {
    if (typeof segment?.text !== "string" || segment.text.length > 2000) throw invalidTranscript();
    text += `${text ? " " : ""}${segment.text.trim()}`;
    if (text.length > 20000) throw invalidTranscript();
  }
  const coarse = parseTranscriptionResult({ text, segments: output.segments }, duration);
  const precise = [];
  let count = 0;
  for (const [index, segment] of output.segments.entries()) {
    const words = alignedWordSegments(segment, duration) ?? [coarse.segments[index]];
    count += words.length;
    if (count <= 300) precise.push(...words);
  }
  // Preserve complete coverage when word detail exceeds the native observation budget.
  return count <= 300 ? { text: coarse.text, segments: precise } : coarse;
}

function waitForPoll(milliseconds, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Consume already-validated WAV data through one owned, bounded Runpod job. */
export async function transcribeRunpodAudio(env, { audio, duration }, signal, {
  fetch: send = globalThis.fetch, deadlineMs = TRANSCRIPTION_DEADLINE_MS, pollMs = 1000, cancelMs = 2000,
} = {}) {
  if (!runpodTranscriptionConfigured(env)) throw new HttpError(503, "Audio transcription is not configured for this provider.");
  if (typeof audio !== "string" || !audio.length || audio.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4
    || !Number.isFinite(duration) || duration <= 0 || duration > MAX_AUDIO_SECONDS)
    throw new HttpError(400, "Send up to 60 seconds of mono 16 kHz PCM WAV audio.");
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > TRANSCRIPTION_DEADLINE_MS
    || !Number.isFinite(pollMs) || pollMs < 0 || pollMs > 5000
    || !Number.isFinite(cancelMs) || cancelMs <= 0 || cancelMs > 2000)
    throw new HttpError(503, "Audio transcription is not configured correctly.");
  const prefix = `/v2/${env.RUNPOD_TRANSCRIPTION_ENDPOINT}`;
  const request = (path, payload, activeSignal, method = "POST") => requestRunpodJson(
    `${prefix}/${path}`, payload, env.RUNPOD_API_KEY, activeSignal,
    { fetch: send, method, maxBytes: RESPONSE_BYTES },
  );
  let jobId = null;
  let finished = false;
  try {
    return await withAssistantDeadline(async activeSignal => {
      let job = await request("run", {
        input: { audio_file: `data:audio/wav;base64,${audio}`, align_output: true, diarization: false, batch_size: 16 },
        // TTL also bounds an ambiguously accepted submission whose job ID never reaches us.
        policy: { executionTimeout: Math.max(5000, deadlineMs), ttl: Math.max(10000, deadlineMs) },
      }, activeSignal);
      if (typeof job?.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(job.id)) throw invalidTranscript();
      jobId = job.id;
      while (true) {
        activeSignal.throwIfAborted();
        if (job.id !== jobId) throw invalidTranscript();
        finished = terminalStates.has(job.status);
        if (job.status === "COMPLETED") return parseRunpodTranscriptionOutput(job.output, duration);
        if (finished) throw new HttpError(422, "Audio transcription did not finish. Try a shorter range.");
        if (!["IN_QUEUE", "IN_PROGRESS"].includes(job.status)) throw invalidTranscript();
        await waitForPoll(pollMs, activeSignal);
        job = await request(`status/${jobId}`, undefined, activeSignal, "GET");
      }
    }, deadlineMs, signal);
  } finally {
    if (jobId && !finished) {
      // Stop only this request's job. Cancellation has its own short deadline.
      try {
        await withAssistantDeadline(cancelSignal => request(`cancel/${jobId}`, undefined, cancelSignal), cancelMs);
      } catch {
        console.warn(JSON.stringify({ operation: "native-assistant", provider: "runpod", stage: "transcription-cancel", status: "failed" }));
      }
    }
  }
}
