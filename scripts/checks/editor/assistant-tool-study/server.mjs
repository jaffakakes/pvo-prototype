import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { parseNativeTurnRequest } from "../../../../packages/pvo-assistant/native/index.js";
import { HttpError, readJson } from "../../../../server/http.js";
import { nativeAssistantTurn } from "../../../../server/assistant/native/service.js";
import { validateNativeInput } from "../../../../server/assistant/native/policy.js";
import { readTranscriptionAudio } from "../../../../server/assistant/native/audio.js";
import { runpodNativeModels, RUNPOD_NATIVE_MODEL } from "../../../../server/assistant/native/runpod.js";
import { transcribeRunpodAudio } from "../../../../server/assistant/native/runpodAudio.js";
import { STUDY_VARIANTS, studyImageHash, studyValueHash, wrapStudyModels } from "./variant-provider.mjs";

const LOCAL_MCP_MARKER = "local-study-relay-discards-this-marker";
const fields = new Set(["trialId", "pairId", "replicate", "variant", "stage", "request"]);

function trialInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !fields.has(key))
    || !["trialId", "pairId"].every(key => typeof value[key] === "string" && /^[a-zA-Z0-9_.-]{1,160}$/.test(value[key]))
    || !Number.isInteger(value.replicate) || value.replicate < 1
    || !STUDY_VARIANTS.includes(value.variant) || !["frozen", "live"].includes(value.stage))
    throw new HttpError(400, "Send a valid isolated study trial.");
  try {
    const request = parseNativeTurnRequest(value.request);
    validateNativeInput(request);
    return { ...value, request };
  } catch { throw new HttpError(400, "Send a valid native assistant request."); }
}

function frozenVision(bank) {
  const descriptions = new Map();
  for (const entry of bank.vision ?? []) {
    if (typeof entry.imageSha256 !== "string" || typeof entry.description !== "string" || !entry.description.trim())
      throw new Error("Frozen vision entries need an image digest and actual description.");
    if (descriptions.has(entry.imageSha256) && descriptions.get(entry.imageSha256) !== entry.description)
      throw new Error("Frozen vision contains conflicting descriptions for identical image bytes.");
    descriptions.set(entry.imageSha256, entry.description);
  }
  return async ({ image }, signal) => {
    signal.throwIfAborted();
    const description = descriptions.get(studyImageHash(image));
    if (!description) throw new HttpError(422, "This exact frame is not in the frozen study evidence bank.");
    return description;
  };
}

/** HTTP test boundary only; production contracts, routes and editor execution stay unchanged. */
export function createStudyHandler({ modelsForTrial, transcribe, compile, bank = null, bankHash = null }) {
  const describeFrozenFrame = bank ? frozenVision(bank) : null;
  return async request => {
    const telemetry = [];
    try {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/study/health" && request.method === "GET") return Response.json({
        ready: true, model: RUNPOD_NATIVE_MODEL, variants: STUDY_VARIANTS, stages: ["frozen", "live"], bankHash,
        frozenVisionImages: bank?.vision?.length ?? 0,
        settings: { thinking: { type: "disabled" }, temperature: 0.6, textAttemptMs: 60000, frameAttemptMs: 60000, totalMs: 90000 },
      });
      if (request.method !== "POST") throw new HttpError(405, "Use POST for study inference.");
      if (pathname === "/study/transcribe") {
        if (request.headers.get("X-Study-Stage") !== "live")
          throw new HttpError(400, "Live transcription requires the explicit live study stage.");
        const audio = await readTranscriptionAudio(request);
        return Response.json(await transcribe(audio, request.signal, request.headers.get("X-Study-Trial")));
      }
      if (pathname !== "/study/turn") throw new HttpError(404, "Unknown study route.");
      const trial = trialInput(await readJson(request, 3 * 1024 * 1024 + 2048));
      if (trial.stage === "frozen" && !describeFrozenFrame) throw new HttpError(503, "Frozen evidence bank is unavailable.");
      const baseModels = modelsForTrial(trial, event => telemetry.push(event));
      const models = wrapStudyModels(trial.stage === "frozen"
        ? { ...baseModels, describeFrame: describeFrozenFrame } : baseModels, {
        variant: trial.variant,
        sharedInstruction: trial.stage === "frozen" ? bank.sharedInstruction ?? "" : "",
        record: event => telemetry.push(event),
      });
      const result = await nativeAssistantTurn(trial.request, { models, signal: request.signal, compile });
      return Response.json({ result, telemetry });
    } catch (error) {
      return Response.json({ error: error instanceof HttpError ? error.message : "The isolated study request failed.",
        errorType: error.name, telemetry }, { status: error instanceof HttpError ? error.status : 500 });
    }
  };
}

/** The authenticated local MCP connection owns credentials; none travel in the study proxy. */
export function createRelayFetch(relayUrl, { session, transcriptionEndpoint, fetch: send = globalThis.fetch, record = () => {} }) {
  const relay = new URL(relayUrl);
  if (relay.protocol !== "http:" || relay.hostname !== "127.0.0.1" || relay.pathname !== "/relay"
    || relay.username || relay.password || relay.search || relay.hash)
    throw new Error("Use the exact isolated loopback MCP relay URL.");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(transcriptionEndpoint)) throw new Error("Invalid study transcription endpoint.");
  return async (target, options = {}) => {
    const url = new URL(target);
    const prefix = `/v2/${transcriptionEndpoint}/`;
    if (url.origin !== "https://api.runpod.ai" || url.search || url.hash
      || !(url.pathname === "/v2/moonshot-kimi/openai/v1/chat/completions" || url.pathname.startsWith(prefix)))
      throw new Error("Unexpected study provider endpoint.");
    const originalHeaders = new Headers(options.headers);
    const headers = { "X-Runpod-Target": url.href, "X-Pvo-Test-Session": session };
    if (originalHeaders.has("Content-Type")) headers["Content-Type"] = originalHeaders.get("Content-Type");
    const payload = options.body ? JSON.parse(options.body) : null;
    record({ kind: "provider-request", path: url.pathname, method: options.method ?? "GET",
      payloadHash: studyValueHash(payload), model: payload?.model ?? null,
      settings: payload?.model ? { temperature: payload.temperature, thinking: payload.thinking, max_tokens: payload.max_tokens, stream: payload.stream } : null });
    return send(relay.href, { ...options, headers, redirect: "manual" });
  };
}

async function start() {
  const options = Object.fromEntries(process.argv.slice(2).map(value => {
    const match = /^--([a-z-]+)=(.+)$/.exec(value);
    if (!match) throw new Error("Use --option=value for study server options.");
    return [match[1], match[2]];
  }));
  for (const key of Object.keys(options)) if (!["port", "bank", "relay-url", "relay-session", "transcription-endpoint"].includes(key))
    throw new Error(`Unknown study server option: ${key}`);
  const port = Number(options.port ?? 5199);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid study server port.");
  const bankBytes = options.bank ? await readFile(options.bank, "utf8") : null;
  const bank = bankBytes ? JSON.parse(bankBytes) : null;
  const transcriptionEndpoint = options["transcription-endpoint"] ?? "5uqruzvtb96kph";
  const relayOptions = { session: options["relay-session"] ?? "pvo-local-mcp-20261002", transcriptionEndpoint };
  const relayUrl = options["relay-url"] ?? "http://127.0.0.1:5197/relay";
  const { initSync, compile_component_json } = await import("../../../../packages/pvo-language/pkg/pvo_language.js");
  const { readCompilationResult } = await import("../../../../packages/pvo-language/result.js");
  initSync({ module: await readFile(new URL("../../../../packages/pvo-language/pkg/pvo_language_bg.wasm", import.meta.url)) });
  const handler = createStudyHandler({
    bank, bankHash: bankBytes ? studyValueHash(bankBytes) : null,
    modelsForTrial: (_trial, record) => runpodNativeModels(LOCAL_MCP_MARKER, {
      fetch: createRelayFetch(relayUrl, { ...relayOptions, record }),
    }),
    compile: async (kind, source) => readCompilationResult(compile_component_json(kind, source.structure, source.style, source.logic)),
    transcribe: (audio, signal) => transcribeRunpodAudio({ RUNPOD_API_KEY: LOCAL_MCP_MARKER,
      RUNPOD_TRANSCRIPTION_ENDPOINT: transcriptionEndpoint }, audio, signal, { fetch: createRelayFetch(relayUrl, relayOptions) }),
  });
  const server = createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    outgoing.on("close", () => { if (!outgoing.writableEnded) controller.abort(); });
    try {
      const request = new Request(`http://127.0.0.1:${port}${incoming.url}`, {
        method: incoming.method, headers: incoming.headers, signal: controller.signal,
        ...(["GET", "HEAD"].includes(incoming.method) ? {} : { body: Readable.toWeb(incoming), duplex: "half" }),
      });
      const response = await handler(request);
      outgoing.writeHead(response.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ error: "The isolated study transport failed." }));
    }
  });
  server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ event: "study-server-ready", port, model: RUNPOD_NATIVE_MODEL, bankHash: bankBytes ? studyValueHash(bankBytes) : null })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await start();
