import { createHash } from "node:crypto";

export const STUDY_VARIANTS = ["separate", "coordinated"];
export const COORDINATED_OBSERVATION_INSTRUCTION = `
Additional optional footage observation for this interface:
{kind:"inspect_media",sceneId,transcript?:{start,end},frames?:{start,end,count:1..6}}
Supply at least one modality. Transcript and frames have independent scene-timeline ranges; include only the modalities needed for the current request. The existing separate transcript and frames observations remain available, including requesting both in the same reply. Either representation invokes exactly the same observation capabilities and returns the same evidence. Each supplied modality counts as one observation toward all existing request/task limits. The order of modality properties is the execution order. This tool adds no evidence, timing precision, automatic range selection, or verification. All existing evidence, range, response and editing rules still apply.`;

export function studyValueHash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function studyImageHash(image) {
  const match = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(image);
  if (!match) throw new Error("Study vision requires a base64 image data URL.");
  return createHash("sha256").update(Buffer.from(match[1], "base64")).digest("hex");
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expandObservation(observation, logicalIndex, mappings) {
  if (!object(observation) || observation.kind !== "inspect_media") {
    mappings.push({ logicalIndex, logicalKind: observation?.kind ?? null, canonicalKinds: [observation?.kind ?? null] });
    return [observation];
  }
  if (Object.keys(observation).some(key => !["kind", "sceneId", "transcript", "frames"].includes(key)))
    throw new Error("inspect_media has unsupported fields.");
  const modalities = Object.keys(observation).filter(key => key === "transcript" || key === "frames");
  if (!modalities.length) throw new Error("inspect_media requires transcript, frames, or both.");
  const expanded = modalities.map(kind => {
    const options = observation[kind];
    if (!object(options)) throw new Error(`inspect_media.${kind} must be an object.`);
    const keys = kind === "frames" ? ["start", "end", "count"] : ["start", "end"];
    if (Object.keys(options).some(key => !keys.includes(key)))
      throw new Error(`inspect_media.${kind} has unsupported fields.`);
    return { kind, sceneId: observation.sceneId, ...options };
  });
  mappings.push({ logicalIndex, logicalKind: "inspect_media", canonicalKinds: modalities });
  return expanded;
}

/** Expand only syntax; the unchanged native parser and policy own all limits and validity. */
export function expandStudyResult(content, variant) {
  if (!STUDY_VARIANTS.includes(variant)) throw new Error("Unknown study variant.");
  let value;
  try { value = typeof content === "string" ? JSON.parse(content) : content; }
  catch { return { content, logicalObservations: null, canonicalObservations: null, mappings: [] }; }
  if (!object(value) || !Array.isArray(value.observations))
    return { content, logicalObservations: null, canonicalObservations: null, mappings: [] };
  const logicalObservations = structuredClone(value.observations);
  const mappings = [];
  if (variant === "separate") return {
    content, logicalObservations, canonicalObservations: structuredClone(value.observations),
    mappings: value.observations.map((observation, logicalIndex) => ({
      logicalIndex, logicalKind: observation?.kind ?? null, canonicalKinds: [observation?.kind ?? null],
    })),
  };
  try {
    const observations = value.observations.flatMap((observation, index) => expandObservation(observation, index, mappings));
    const expanded = { ...value, observations };
    return { content: typeof content === "string" ? JSON.stringify(expanded) : expanded,
      logicalObservations, canonicalObservations: structuredClone(observations), mappings };
  } catch (error) {
    // Leave rejected model data intact for the production service's normal repair path.
    return { content, logicalObservations, canonicalObservations: null, mappings: [], normalizationError: error.message };
  }
}

/** Study-only model adapter: no editor, provider, evidence or scheduling behavior changes. */
export function wrapStudyModels(baseModels, { variant, sharedInstruction = "", record = () => {} }) {
  if (!STUDY_VARIANTS.includes(variant)) throw new Error("Unknown study variant.");
  let sequence = 0;
  return {
    ...baseModels,
    async generate(input, signal) {
      const call = ++sequence;
      const started = performance.now();
      const baseline = { ...input, messages: input.messages.map((message, index) => index === 0 && sharedInstruction
        ? { ...message, content: `${message.content}\n\n${sharedInstruction}` } : message) };
      const messages = baseline.messages.map((message, index) => index === 0 && variant === "coordinated"
        ? { ...message, content: message.content + COORDINATED_OBSERVATION_INSTRUCTION } : message);
      if (messages[0]?.role !== "system" || typeof messages[0].content !== "string")
        throw new Error("Study expects the native system prompt as its first message.");
      const forwarded = { ...input, messages };
      const audit = { kind: "planning", call, variant, inputHash: studyValueHash(forwarded),
        baselineInputHash: studyValueHash(baseline), input: structuredClone(forwarded) };
      try {
        const result = await baseModels.generate(forwarded, signal);
        const { content, ...mapping } = expandStudyResult(result?.content, variant);
        record({ ...audit, ...mapping, rawContent: result?.content, outcome: "returned",
          durationMs: Math.round(performance.now() - started) });
        return result && object(result) ? { ...result, content } : result;
      } catch (error) {
        record({ ...audit, outcome: signal.aborted ? "cancelled" : "failed", error: { name: error.name, status: error.status },
          durationMs: Math.round(performance.now() - started) });
        throw error;
      }
    },
    async describeFrame(input, signal) {
      const call = ++sequence;
      const started = performance.now();
      const audit = { kind: "vision", call, variant, question: input.question, imageSha256: studyImageHash(input.image) };
      try {
        const description = await baseModels.describeFrame(input, signal);
        record({ ...audit, description, outcome: "returned", durationMs: Math.round(performance.now() - started) });
        return description;
      } catch (error) {
        record({ ...audit, outcome: signal.aborted ? "cancelled" : "failed", error: { name: error.name, status: error.status },
          durationMs: Math.round(performance.now() - started) });
        throw error;
      }
    },
  };
}
