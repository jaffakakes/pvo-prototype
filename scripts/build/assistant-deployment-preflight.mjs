import { parseNativeTurnResult } from "../../packages/pvo-assistant/native/index.js";

const REQUIRED_CAPABILITIES = ["editing", "frames", "transcription"];
const STATUS_MAX_BYTES = 16 * 1024;
const TURN_MAX_BYTES = 96 * 1024;

function preflightTurnRequest() {
  return {
    mode: "edit",
    prompt: "Rename the current scene to Release preflight ready. Make no other changes and do not inspect media.",
    history: [], observations: [],
    project: {
      fingerprint: "release-preflight", currentSceneId: "release-preflight", playhead: 0, ratio: "9:16",
      canvas: { width: 1080, height: 1920 },
      selection: { clipId: null, textId: null, componentId: null, audioId: null },
      scenes: [{
        id: "release-preflight", name: "Release preflight", parent: null, duration: 1,
        muted: false, musicGain: 1, clipGain: 1,
        clips: [], texts: [], audioClips: [], components: [],
      }],
    },
  };
}

async function readBoundedJson(response, label, maximum) {
  const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json") throw new Error(`${label} returned ${type ?? "no content type"}, not JSON.`);
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum))
    throw new Error(`${label} response exceeds its size limit.`);
  if (!response.body) throw new Error(`${label} returned no response body.`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error(`${label} response exceeds its size limit.`);
      chunks.push(value);
    }
    complete = true;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} returned invalid JSON.`);
    throw error;
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function runPreflight(origin, fetchImpl, signal) {
  const statusResponse = await fetchImpl(new URL("/api/assistant/status", origin), {
    method: "GET", headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", signal,
  });
  if (statusResponse.status !== 200)
    throw new Error(`Assistant status check failed with HTTP ${statusResponse.status}.`);
  const status = await readBoundedJson(statusResponse, "Assistant status", STATUS_MAX_BYTES);
  const missing = REQUIRED_CAPABILITIES.filter(capability => status?.capabilities?.[capability] !== true);
  if (status?.available !== true || missing.length)
    throw new Error(`Assistant is not ready${missing.length ? `; missing capabilities: ${missing.join(", ")}` : ""}.`);

  const turnResponse = await fetchImpl(new URL("/api/assistant/turn", origin), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(preflightTurnRequest()),
    cache: "no-store", redirect: "error", signal,
  });
  if (turnResponse.status !== 200)
    throw new Error(`Assistant turn check failed with HTTP ${turnResponse.status}.`);
  let result;
  try {
    result = parseNativeTurnResult(await readBoundedJson(turnResponse, "Assistant turn", TURN_MAX_BYTES));
  } catch (error) {
    throw new Error(`Assistant turn check returned an invalid result: ${error.message}`);
  }
  return { status, result };
}

/** Prove the deployed assistant is configured and can complete one real bounded planning request. */
export async function verifyAssistantDeployment({ origin, fetch: fetchImpl = globalThis.fetch, timeoutMs = 100_000 }) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash)
    throw new Error("Assistant deployment preflight requires an exact HTTPS origin.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw new Error("Assistant deployment preflight timeout must be between 1 and 120000 milliseconds.");
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Assistant deployment preflight timed out."));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([runPreflight(base.origin, fetchImpl, controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
