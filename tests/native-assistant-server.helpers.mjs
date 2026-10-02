import { nativeAssistantTurn } from "../server/assistant/native/service.js";
import { cloudflareNativeModels } from "../server/assistant/native/cloudflare.js";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "./worker-bundle.helpers.mjs";

export const NATIVE_ORIGIN = "https://native-assistant.example";
export const nativeInput = () => ({
  mode: "edit", prompt: "Add the title Hello from 2 to 5 seconds and lower the music to 25 percent.", history: [], observations: [],
  project: {
    selection: { clipId: null, textId: null, componentId: null, audioId: null },
    fingerprint: "test-project", currentSceneId: "main", playhead: 0, ratio: "9:16", canvas: { width: 1080, height: 1920 },
    scenes: [{ id: "main", name: "Main", parent: null, duration: 10, muted: false, musicGain: 1, clipGain: 1,
      clips: [{ id: 1, start: 0, end: 10, sourceIn: 2, sourceOut: 22, sourceDuration: 30, speed: 2,
        zoom: 1, mirror: false, fit: "cover", hasMedia: true, audioDetached: false }],
      texts: [], audioClips: [], components: [],
    }],
  },
});
export const nativeDraft = () => ({ message: "I'll add the title and lower the music.", observations: [], operations: [
  { kind: "text.add", sceneId: "main", text: "Hello", start: 2, end: 5 },
  { kind: "scene.update", sceneId: "main", changes: { musicGain: 0.25 } },
] });
export const frameObservation = () => ({
  kind: "frames", sceneId: "main", start: 1, end: 1, coverage: "video-and-text", note: "Single captured frame.",
  frames: [{ sceneTime: 1, clipId: 1, sourceTime: 4, dataUrl: "data:image/png;base64,aGVsbG8=", width: 320, height: 180 }],
});
export function wavAudio(seconds = 1) {
  const bytes = new Uint8Array(44 + seconds * 32000);
  const view = new DataView(bytes.buffer);
  const write = (offset, text) => bytes.set(new TextEncoder().encode(text), offset);
  write(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, bytes.length - 44, true);
  return bytes;
}
let modules;
export async function nativeFixture({
  outputs = [{ response: nativeDraft() }], available = true, origin = NATIVE_ORIGIN,
  localDevelopment = false, provider = "cloudflare", runpodKey = "", transcriptionEndpoint = "",
  alignment = false, tracking = false,
} = {}) {
  modules ??= bundleWorkerModules({ stdin: { resolveDir: process.cwd(), contents: `
    import { handleRequest } from "./server/index.js";
    export default { async fetch(request, env) {
      const AI = env.AI_AVAILABLE ? { async run(model, input, options) {
        const response = await env.MODEL.fetch(new Request("https://model.test/", { method: "POST",
          body: JSON.stringify({ model, input }), signal: options.signal }));
        if (!response.ok) throw Object.assign(new Error(await response.text()), {
          status: response.status, internalCode: Number(response.headers.get("X-Model-Code")) || undefined,
        });
        return response.json();
      } } : undefined;
      const originalFetch = globalThis.fetch;
      if (env.ASSISTANT_PROVIDER === "runpod" || env.MFA_ALIGNMENT_URL || env.SAM_TRACKING_URL) globalThis.fetch = (url, options) => {
        if (!String(url).startsWith("https://api.runpod.ai/v2/") && url !== env.MFA_ALIGNMENT_URL && url !== env.SAM_TRACKING_URL)
          throw new Error("Unexpected test fetch");
        return env.MODEL.fetch(new Request("https://model.test/", { method: "POST",
          body: JSON.stringify({ url: String(url), method: options.method, input: options.body ? JSON.parse(options.body) : null }),
          signal: options.signal, redirect: options.redirect,
        }));
      };
      try { return await handleRequest(request, { ...env, AI }); }
      finally { globalThis.fetch = originalFetch; }
    } };
  ` } });
  const calls = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "native-assistant-route-test", modules: await modules,
    compatibilityDate: "2026-09-27", bindings: {
      PUBLIC_ORIGIN: origin, AI_AVAILABLE: available, ASSISTANT_LOCAL_DEVELOPMENT: String(localDevelopment),
      ASSISTANT_PROVIDER: provider, RUNPOD_API_KEY: runpodKey, RUNPOD_TRANSCRIPTION_ENDPOINT: transcriptionEndpoint,
      MFA_ALIGNMENT_URL: alignment ? "http://127.0.0.1:5198/align" : "",
      MFA_ALIGNMENT_TOKEN: alignment ? "test-local-alignment-token-at-least-32-characters" : "",
      SAM_TRACKING_URL: tracking ? "https://trackingfixture-8000.proxy.runpod.net/track" : "",
      SAM_TRACKING_TOKEN: tracking ? "test-tracking-token-at-least-32-characters" : "",
    },
    serviceBindings: {
      MODEL: async request => {
        calls.push(await request.json());
        const output = outputs[calls.length - 1];
        return output instanceof Response ? output : Response.json(output);
      },
    },
  }));
  const fetch = (path, options = {}) => mf.dispatchFetch(`${origin}/api/assistant/${path}`, {
    ...options, headers: { Origin: origin, ...options.headers },
  });
  return { calls, close: () => mf.dispose(), fetch,
    turn: (body = nativeInput(), options = {}) => fetch("turn", {
      method: "POST", body: JSON.stringify(body), ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    }),
    transcribe: (audio = wavAudio(), options = {}) => fetch("transcribe", {
      method: "POST", body: audio, ...options, headers: { "Content-Type": "audio/wav", ...options.headers },
    }),
  };
}

export function cloudflareTurn(request, { ai, ...options }) {
  return nativeAssistantTurn(request, { ...options, models: cloudflareNativeModels(ai) });
}
