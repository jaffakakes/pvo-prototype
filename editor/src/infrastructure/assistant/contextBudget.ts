import type { NativeObservation, NativeTurnRequest } from "../../../../packages/pvo-assistant/native/index.js";
import type { AssistantEvidence, AssistantMessage } from "../../domain/assistant/model";
import { AssistantServiceError } from "../../domain/assistant/failure";

// Match the server's textual request boundary; frame bytes have a separate limit.
const MAX_CONTEXT_BYTES = 48 * 1024;
const MAX_SESSION_BYTES = 16 * 1024;
const MAX_MESSAGE_CHARACTERS = 8000;
const MAX_RETAINED_ENTRY_BYTES = 4096;
const encoder = new TextEncoder();
const byteLength = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
const marker = "… [truncated]";

type ContentEntry = { content: string };

/** Truncate only message text, preserving Unicode characters and the JSON envelope. */
function fitEntry<T extends ContentEntry>(entry: T, budget: number): T | null {
  if (entry.content.length <= MAX_MESSAGE_CHARACTERS && byteLength(entry) <= budget) return { ...entry };
  const characters = Array.from(entry.content);
  let lower = 0;
  let upper = characters.length;
  let fitted: T | null = null;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const candidate = { ...entry, content: characters.slice(0, middle).join("") + marker };
    if (candidate.content.length <= MAX_MESSAGE_CHARACTERS && byteLength(candidate) <= budget) {
      fitted = candidate;
      lower = middle + 1;
    } else upper = middle - 1;
  }
  // A bare truncation marker contributes no usable context.
  return fitted && fitted.content.length > marker.length ? fitted : null;
}

function recentEntries<T extends ContentEntry>(entries: readonly T[], count: number, budget: number,
  entryBudget = budget): T[] {
  const selected: T[] = [];
  let used = 2; // JSON array brackets.
  for (const entry of entries.slice(-count).reverse()) {
    const separator = selected.length ? 1 : 0;
    const fitted = fitEntry(entry, Math.min(entryBudget, budget - used - separator));
    if (!fitted) continue;
    selected.push(fitted);
    used += byteLength(fitted) + separator;
  }
  return selected.reverse();
}

export function retainAssistantHistory(history: readonly AssistantMessage[]): AssistantMessage[] {
  return recentEntries(history, 12, MAX_SESSION_BYTES, MAX_RETAINED_ENTRY_BYTES);
}

export function retainAssistantEvidence(evidence: readonly AssistantEvidence[]): AssistantEvidence[] {
  return recentEntries(evidence, 8, MAX_SESSION_BYTES, MAX_RETAINED_ENTRY_BYTES);
}

/** Preserve complete timing entries and disclose omitted words instead of cutting a JSON array. */
export function assistantObservationMemory(observation: NativeObservation): string {
  if (observation.kind === "object_tracking") return JSON.stringify({
    kind: observation.kind, sceneId: observation.sceneId, clipId: observation.clipId,
    start: observation.start, end: observation.end, model: observation.model, frameCount: observation.frameCount,
    visibleSamples: observation.samples.filter(sample => sample.visible && sample.score >= 0.25).length,
    note: "Historical tracking summary only. To author a new follow action, run a fresh object-tracking tool in the current request.",
  });
  if (observation.kind !== "word_timing") return JSON.stringify(observation);
  const { words, text: _text, ...metadata } = observation;
  const lines: string[] = [];
  const summary = () => [
    "Measured word timing for supplied text, not verified speech. Only complete word entries are evidence.",
    JSON.stringify(metadata),
    `Retained ${lines.length} of ${words.length} word timings; ${words.length - lines.length} omitted. Do not infer omitted boundaries.`,
    ...lines,
  ].join("\n");
  for (const word of words) {
    lines.push(JSON.stringify(word));
    // Leave room for the observation fingerprint, evidence envelope and Unicode escaping.
    if (byteLength({ content: summary() }) > 3000) { lines.pop(); break; }
  }
  return summary();
}

/** Reserve current project, prompt and observation data before spending bytes on history. */
export function assistantContextHistory(context: Omit<NativeTurnRequest, "history">,
  history: readonly AssistantMessage[]): AssistantMessage[] {
  const observations = context.observations.map(observation => observation.kind === "frames"
    ? { ...observation, frames: observation.frames.map(({ dataUrl: _image, ...frame }) => frame) }
    : observation);
  const fixedBytes = byteLength({ ...context, observations, history: [] });
  if (fixedBytes > MAX_CONTEXT_BYTES)
    throw new AssistantServiceError(413, "The current project and media context exceed the assistant request limit.");
  return recentEntries(history, 12, MAX_CONTEXT_BYTES - fixedBytes + 2);
}
