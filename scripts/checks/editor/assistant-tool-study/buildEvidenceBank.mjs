import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256, observationKey } from "./evidenceBank.mjs";

const execute = promisify(execFile);
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const [name, ...rest] = value.replace(/^--/, "").split("=");
  return [name, rest.join("=")];
}));
const output = path.resolve(args.output ?? "/tmp/pvo-assistant-tool-study-evidence");
const prior = path.resolve(args.prior ?? "/tmp/pvo-assistant-acceptance-retest");
const sourceFile = path.resolve(args.media ?? process.env.ACCEPTANCE_MEME_VIDEO
  ?? "/Users/christinasmacbook/Downloads/snaptik_7643305471486545166_hd.mp4");
for (const key of Object.keys(args)) assert(["output", "prior", "media"].includes(key), `Unknown argument ${key}`);
const json = async file => JSON.parse(await readFile(file, "utf8"));
const sourceBytes = await readFile(sourceFile);
const mediaResult = await json(path.join(prior, "media-opening-memory/result.json"));
assert.equal(path.resolve(mediaResult.media.path), sourceFile, "Source must be the original recorded media");
const duration = mediaResult.media.duration;
const mapping = changes => ({ sceneId: "main", clipId: 101, sourceIn: 0, sourceOut: duration, speed: 1,
  muted: false, clipGain: 1, audioDetached: false, sourceDuration: duration, ...changes });
const bank = {
  schemaVersion: 1, createdAt: new Date().toISOString(),
  source: { path: sourceFile, sha256: sha256(sourceBytes), duration, width: mediaResult.media.width, height: mediaResult.media.height },
  sharedInstruction: "This is a controlled media-tool comparison. Each creator request declares the exact available frozen inspection windows. Both tool interfaces use the same underlying evidence. Choose only relevant modalities. Unavailable windows are missing evidence, not silence. Frozen ASR and visual descriptions may be imperfect; do not infer exact word/speaker timing from coarse spans.",
  description: "Real prior ASR and vision wording replayed unchanged. Frame pixels reconstructed from the same source at the registered sample times; prior image bytes were not retained. This stage measures interface/evidence-use behavior, not fresh ASR, video decoding accuracy or production media latency. The authored-muted control is deterministic empty audio, explicitly identified below.",
  entries: [], vision: [],
};
await mkdir(path.join(output, "frames"), { recursive: true });

function priorFrameDescriptions(step) {
  return step.evidence.flatMap(item => {
    const match = /Sampled frame \(video\/text only; interactive components excluded\) (\{[^\n]*\}): ([\s\S]*)$/.exec(item.content);
    return match ? [{ ...JSON.parse(match[1]), description: match[2] }] : [];
  });
}

async function addRecorded(caseId, stepNumber, kind, changes = {}) {
  const artifact = path.join(prior, caseId, `step-${stepNumber}.json`);
  const step = await json(artifact);
  const recorded = step.observations.find(item => item.request.kind === kind);
  assert(recorded?.result?.kind === kind, `Missing recorded ${kind}: ${artifact}`);
  const result = structuredClone(recorded.result);
  if (kind === "frames") {
    const descriptions = priorFrameDescriptions(step);
    for (const frame of result.frames) {
      const description = descriptions.find(item => item.sceneTime === frame.sceneTime && item.sourceTime === frame.sourceTime);
      assert(description?.description, `Missing recorded description at ${frame.sceneTime}`);
      const filename = `source-${String(frame.sourceTime).replace(".", "-")}.png`;
      const target = path.join(output, "frames", filename);
      await execute("ffmpeg", ["-v", "error", "-y", "-ss", String(frame.sourceTime), "-i", sourceFile,
        "-vf", `scale=${frame.width}:${frame.height}`, "-frames:v", "1", target]);
      const bytes = await readFile(target);
      const imageSha256 = sha256(bytes);
      const existing = bank.vision.find(item => item.imageSha256 === imageSha256);
      if (!existing) bank.vision.push({ imageSha256, description: description.description,
        sourceTime: frame.sourceTime, sceneTime: frame.sceneTime, artifact, frameFile: path.relative(output, target) });
      frame.dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
      delete frame.imageBytes;
    }
  }
  bank.entries.push({ mapping: mapping(changes), request: recorded.request, result,
    provenance: { kind: "recorded-real-provider", artifact, originalStepSha256: sha256(await readFile(artifact)),
      observationRequest: recorded.request, wordingChanged: false } });
}

await addRecorded("media-after-trim", 1, "transcript");
await addRecorded("media-opening-memory", 1, "transcript");
await addRecorded("media-after-trim", 3, "transcript", { sourceIn: 2 });
await addRecorded("media-opening-memory", 1, "frames");
await addRecorded("media-final-ranking", 1, "frames");
bank.entries.push({ mapping: mapping({ muted: true }), request: { kind: "transcript", sceneId: "main", start: 0, end: 4 },
  result: { kind: "transcript", sceneId: "main", start: 0, end: 4, text: "", segments: [] },
  provenance: { kind: "deterministic-authored-mute", reason: "The entire authored scene is muted; inspectionAudio returns no audible samples. This is not a fabricated provider response." } });
assert.equal(new Set(bank.entries.map(item => observationKey([item.mapping, item.request]))).size, bank.entries.length);
const file = path.join(output, "bank.json");
await writeFile(file, JSON.stringify(bank, null, 2));
await writeFile(path.join(output, "manifest.json"), JSON.stringify({ schemaVersion: 1, source: bank.source,
  bankSha256: sha256(await readFile(file)), entries: bank.entries.map(({ result, ...entry }) => ({ ...entry,
    resultSha256: sha256(JSON.stringify(result)) })), vision: bank.vision }, null, 2));
console.log(JSON.stringify({ file, entries: bank.entries.length, frames: bank.vision.length,
  bankSha256: sha256(await readFile(file)) }));
