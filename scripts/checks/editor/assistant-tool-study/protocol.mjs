import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { studyCaseMetadata } from "./cases.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");

export const studyProtocol = {
  id: "pvo-optional-media-inspector-v1", schemaVersion: 1, registeredDate: "2026-10-02",
  question: "Does adding an optional combined media-inspection alias improve task completion or reduce coordination work compared with the existing separate observation interface?",
  treatment: {
    A: "Existing transcript and frames observation requests, already permitted together in one native turn.",
    B: "The same interface plus optional inspect_media with independently selected transcript/frame windows. The alias expands into the identical canonical observations before the same executor.",
    interpretation: "This is an optional interface affordance comparison, not sequential versus parallel execution. There is no ASR, vision, scheduling or media-processing upgrade in either arm.",
  },
  stages: {
    frozen: { cases: 10, repetitions: 3, arms: 2, plannedCaseAttempts: 60,
      scope: "Real planner inference against identical preregistered recorded ASR/vision wording. Source frame pixels are reconstructed at the registered source samples. Measures planning/evidence use, not new media-inference accuracy or production media latency." },
    live: { caseIds: ["opening-multimodal", "final-ranking-visual", "caption-followup"], repetitions: 2, arms: 2,
      plannedCaseAttempts: 12, scope: "Small external-validity confirmation through real media/provider work, analyzed separately. Not powered to establish broad product superiority." },
  },
  coordinationRelevantCaseIds: ["opening-multimodal", "speaker-evidence-boundary", "caption-followup"],
  matching: [
    "Match case and repetition; same initial authored state, prompt, model/version/settings and evidence source. Keep each pair adjacent with balanced AB/BA order.",
    "Use fresh conversation, history and media cache per case attempt; keep follow-up history only within its registered two-step case.",
    "Use the same exact finite inspection menu in both arms. No nearest-window answers, interpolated transcripts or arm-specific missing-evidence policy.",
    "Both arms have identical native-turn, canonical-observation, duration, frame-count and output limits. One B alias consumes the number of canonical observations it expands into.",
    "Do not replay failed model outputs, repair prompts, substitute provider responses or alter oracles after seeing outcomes. Any implementation correction requires a versioned rerun retained separately.",
  ],
  groundTruth: {
    visual: "Large title/ranking and visible subject change reviewed against source frames, not inferred solely from model descriptions.",
    speech: "Quotation tasks score faithfulness to the actual transcript observation delivered in that attempt, not independently verified transcription accuracy. Agreement of live ASR with the frozen reference is a separate diagnostic and does not change the registered task oracle. The same recorded model errors remain available to both frozen arms.",
    timing: "No ASR-derived exact speech time is scored as human truth. Exact arithmetic uses a reference marker supplied in the prompt. The coarse-timing case requires explicit uncertainty and no guessed boundary.",
    silence: "Deterministic scene mute establishes no audible authored speech; empty transcript is a declared authored-state control.",
    unsupported: "The known frame tool excludes interactive components, so it cannot establish rendered button overlap. Honest refusal passes this control without becoming a new product capability.",
    edits: "Verify actual authored postconditions, footage preservation, atomic commit and undo/redo, not the assistant's success message.",
  },
  outcomes: {
    primary: "Per-case success requires every registered step and mandatory workflow/oracle assertion to pass. Capability-gap controls pass only when the limitation is honestly handled without a change. A skipped follow-up is not a success.",
    secondary: ["False completion: explicit completion claim contradicted by a failed required postcondition; uncertainty/refusal and infrastructure interruption are separate.",
      "Canonical observations and requested modality units: transcript source/timeline seconds, sampled frames, underlying provider jobs; logical alias calls counted separately.",
      "Unnecessary modality requests on speech-only, visual-only and context-control cases.",
      "Native turns, preparation attempts, repair calls, tokens/cost when measured, success-only and all-attempt p50/p90 latency.",
      "Alias adoption rate in B. B may legitimately choose the existing separate calls."],
    falseCompletionOperationalization: "Report candidates when a completed native result has a failed semantic oracle and valid answer format, rather than a transport failure or format-only failure. Preserve answer and assertion for review; label candidates separately from confirmed false completion. No substring-only detector is treated as a full semantic adjudication.",
  },
  analysis: {
    unit: "Case is the generalization cluster; three repetitions are not thirty independent task types. Preserve matched repetition pairs within each case.",
    primaryEffect: "B minus A case-success rate over conclusive complete pairs, with 95% paired case-cluster bootstrap percentile interval (20000 deterministic-seed resamples).",
    exactTest: "Two-sided paired case-cluster sign-flip randomization on mean within-case success difference; enumerate 2^K flips for K<=20. Report unadjusted p-value descriptively; small heterogeneous hand-selected corpus limits inference.",
    latency: "Nearest-rank p50/p90 for each arm/stage/category. Paired latency differences only where both attempts succeed; all-attempt durations remain separately visible. Frozen and live timings never pooled.",
    exclusions: "Only evidence-backed infrastructure/allowance/checker failures are excluded from conclusive semantic quality. Raw results remain visible, excluded pairs are counted, and any rerun is separately labelled. Model timeout/loop exhaustion is a semantic workflow failure unless independent infrastructure evidence says otherwise.",
    decision: "Recommend the optional alias only if quality improves without new false completion or if success-preserving coordination savings are consistent. If inconclusive or neutral, retain the simpler current interface. A faster incorrect answer is not an improvement.",
    subgroup: "Report the three preregistered multimodal coordination-relevant cases separately. Single-modality/context controls are not expected to benefit from combining tools; subgroup results are secondary and not a replacement for the full corpus.",
  },
  limitations: [
    "One real compilation and controlled authored variants; results do not establish general video understanding or human editing parity.",
    "The corpus was intentionally selected from prior acceptance outcomes, not held out from development. Exact inspection windows, JSON formats and evidence-limit cues constrain behavior and limit generalization.",
    "A already batches modalities, so there may be little measurable difference from the alias.",
    "JSON answer-format requirements improve objective scoring but differ from normal conversational use.",
    "Frozen provider outputs can contain errors; this study deliberately does not fix them in only one arm.",
    "The temporary MCP bridge adds transport/operator delay. Provider execution, queue, relay waiting and end-to-end must be reported separately, never naively subtracted.",
  ],
  cases: studyCaseMetadata,
};

export async function registerStudyProtocol(bankFile) {
  const [bank, corpus, protocol] = await Promise.all([
    readFile(bankFile), readFile(new URL("./cases.mjs", import.meta.url)), readFile(new URL("./protocol.mjs", import.meta.url)),
  ]);
  const fingerprints = { bankSha256: hash(bank), oracleImplementationSha256: hash(corpus),
    protocolImplementationSha256: hash(protocol), promptAndCaseSha256: hash(JSON.stringify(studyCaseMetadata)) };
  return { ...studyProtocol, fingerprints, protocolSha256: hash(JSON.stringify({ protocol: studyProtocol, fingerprints })) };
}
