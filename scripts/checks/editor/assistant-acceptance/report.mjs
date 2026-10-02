import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const usage = `Usage: node scripts/checks/editor/assistant-acceptance/report.mjs
  --runs DIR[,DIR...] --capabilities FILE --reliability FILE --output DIR
  [--relay-metrics FILE] [--annotations FILE] [--audio-investigation FILE] [--playback-replay FILE]
  [--recoveries DIR[,DIR...]] [--smoke-runs DIR[,DIR...]]
  [--retests DIR[,DIR...]] [--preliminary DIR[,DIR...]]

Repeat --runs to include more directories. All designated directories must also
appear in --runs. Every attempt is retained; retests never replace the first result.
Recoveries require a confirmed interrupted baseline case in the annotations file.
No provider/bridge duration is subtracted from end-to-end latency.

Annotations: {"schemaVersion":1,"trials":[{"run":"/absolute/run","caseId":"case-id",
"step":1,"classification":"infrastructure-interrupted","reason":"Confirmed cause",
"endedAt":"exact recorded ISO timestamp","evidence":[{"file":"/path/log","excerpt":"Evidence"}]}]}
Classification may also be "under-investigation" or "provider-allowance-blocked".
These remain visible and are excluded from conclusive quality and valid-trial
latency. A rejected request is not a measured inference.
Optional environment describes testedProvider, transport, normalBetaProvider,
and speedCaveat. Optional runContexts records run/provider/bridgeVariant/purpose
for mixed-provider or changed-bridge suites; these appear prominently in HTML.`;
const statuses = ["PASS", "FAIL", "CAPABILITY_GAP", "NOT_RUN", "FIXTURE_READY"];
const validities = ["valid", "infrastructure-interrupted", "under-investigation", "provider-allowance-blocked"];
const finite = value => typeof value === "number" && Number.isFinite(value);
const milliseconds = value => finite(value) ? value : typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const sum = values => values.reduce((total, value) => total + value, 0);
const counts = rows => Object.fromEntries(statuses.map(status => [status, rows.filter(row => row.status === status).length]));
const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function optionsFrom(argv) {
  const options = { runs: [], retests: [], recoveries: [], preliminary: [], "smoke-runs": [] };
  const allowed = new Set(["runs", "retests", "recoveries", "preliminary", "smoke-runs", "capabilities", "reliability", "relay-metrics", "annotations", "audio-investigation", "playback-replay", "output"]);
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--help") return null;
    const match = /^--([^=]+)(?:=(.*))?$/.exec(argv[index]);
    assert(match && allowed.has(match[1]), `Unknown argument ${argv[index]}`);
    const value = match[2] ?? argv[++index];
    assert(value && !value.startsWith("--"), `Missing value for --${match[1]}`);
    if (Array.isArray(options[match[1]])) options[match[1]].push(...value.split(",").map(item => path.resolve(item)));
    else { assert(!options[match[1]], `Duplicate --${match[1]}`); options[match[1]] = path.resolve(value); }
  }
  for (const name of ["capabilities", "reliability", "output"]) assert(options[name], `Missing --${name}`);
  assert(options.runs.length, "At least one --runs directory is required");
  assert.equal(new Set(options.runs).size, options.runs.length, "Run directories must be unique");
  const designated = [...options.retests, ...options.recoveries, ...options.preliminary, ...options["smoke-runs"]];
  for (const directory of designated) assert(options.runs.includes(directory), `${directory} must also appear in --runs`);
  assert.equal(new Set(designated).size, designated.length, "A run can have only one designation");
  return options;
}

async function jsonFile(file, optional = false) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (optional && error.code === "ENOENT") return null; throw new Error(`Cannot read ${file}: ${error.message}`, { cause: error }); }
}

function distribution(values) {
  const sorted = values.filter(value => finite(value) && value >= 0).sort((left, right) => left - right);
  const percentile = fraction => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
  return { count: sorted.length, p50Ms: percentile(0.5), p90Ms: percentile(0.9), maxMs: sorted.at(-1) ?? null };
}

function stepStatus(step, fixtureOnly) {
  if (fixtureOnly) return "FIXTURE_READY";
  if (!step) return "NOT_RUN";
  if (step.failure || step.assertionFailures?.length) return "FAIL";
  return step.expectation?.classification === "capability-gap" ? "CAPABILITY_GAP" : "PASS";
}

async function readRun(directory, options) {
  const summary = await jsonFile(path.join(directory, "summary.json"), true);
  const config = summary ?? await jsonFile(path.join(directory, "config.json"));
  const caseIds = config.cases ?? summary?.results?.map(result => result.id) ?? [];
  const cases = [];
  for (const id of caseIds) {
    assert(typeof id === "string" && /^[a-z0-9-]+$/.test(id), `Invalid case ID in ${directory}`);
    const caseDirectory = path.join(directory, id);
    const result = await jsonFile(path.join(caseDirectory, "result.json"), true);
    const plannedCase = config.plannedCases?.find(item => item.id === id);
    const recorded = result ?? summary?.results?.find(item => item.id === id) ?? {
      id, title: plannedCase?.title ?? id, status: "NOT_RUN", failures: [],
      plannedSteps: plannedCase?.steps.length ?? 0, plannedRequests: plannedCase?.steps,
    };
    const files = await readdir(caseDirectory).catch(error => { if (error.code === "ENOENT") return []; throw error; });
    const stepFiles = files.filter(file => /^step-\d+\.json$/.test(file)).sort((left, right) => Number(left.match(/\d+/)[0]) - Number(right.match(/\d+/)[0]));
    const steps = await Promise.all(stepFiles.map(async file => {
      const artifact = path.join(caseDirectory, file);
      const data = await jsonFile(artifact);
      assert(typeof data.prompt === "string" && Array.isArray(data.assertionFailures), `Incomplete step evidence in ${artifact}`);
      return { number: Number(file.match(/\d+/)[0]), data, artifact };
    }));
    cases.push({ ...recorded, artifactDirectory: caseDirectory, steps });
  }
  return { directory, startedAt: config.startedAt ?? null, endedAt: config.endedAt ?? null,
    fixtureOnly: Boolean(config.fixtureOnly), complete: Boolean(summary), measurement: config.measurement ?? null,
    designation: options.preliminary.includes(directory) ? "preliminary" : options.retests.includes(directory) ? "retest"
      : options.recoveries?.includes(directory) ? "infrastructure-recovery"
      : options["smoke-runs"]?.includes(directory) ? "provider-smoke" : "primary", cases };
}

function questionsFrom(runs) {
  const attempts = new Map();
  const primarySeen = new Set();
  const questions = [], caseResults = [];
  for (const run of runs) for (const result of run.cases) {
    const attempt = (attempts.get(result.id) ?? 0) + 1;
    let phase = run.designation;
    if (run.fixtureOnly) phase = "fixture";
    else if (phase === "primary") {
      phase = primarySeen.has(result.id) ? "repeat (not marked retest)" : "first-pass";
      primarySeen.add(result.id);
    }
    if (!run.fixtureOnly && run.designation !== "preliminary") attempts.set(result.id, attempt);
    const caseStatus = run.fixtureOnly ? "FIXTURE_READY" : result.failures?.length ? "FAIL" : result.status;
    caseResults.push({ run: run.directory, id: result.id, title: result.title, phase, attempt, status: caseStatus,
      failures: result.failures ?? [], browserVerification: result.browserVerification ?? null });
    const planned = result.plannedSteps ?? result.steps.length;
    const turnNetwork = (result.network ?? []).filter(entry => entry.method === "POST" && entry.path === "/api/assistant/turn");
    let nextTurn = 0;
    for (let number = 1; number <= Math.max(planned, result.steps.length); number++) {
      const recorded = result.steps.find(step => step.number === number);
      const step = recorded?.data;
      const plannedStep = result.plannedRequests?.[number - 1];
      const turns = step?.turns ?? [];
      const network = turnNetwork.slice(nextTurn, nextTurn + turns.length);
      nextTurn += turns.length;
      const explicitStart = milliseconds(step?.startedAt);
      const networkStart = milliseconds(network[0]?.startedAt);
      const derivedStart = finite(networkStart) && finite(turns[0]?.atMs) ? networkStart - turns[0].atMs : null;
      const start = explicitStart ?? derivedStart;
      const end = milliseconds(step?.endedAt) ?? (finite(start) && finite(step?.endToEndMs) ? start + step.endToEndMs : null);
      const expected = step?.expectation?.outcome ?? plannedStep?.expect ?? null;
      const classification = step?.expectation?.classification ?? result.classification;
      const observations = step?.observations ?? [];
      const category = result.id.startsWith("media-") || observations.length ? "media" : expected === "edit" ? "edit" : "question";
      const failures = step?.assertionFailures ?? [];
      let status = stepStatus(step, run.fixtureOnly);
      if (status === "PASS" && classification === "capability-gap") status = "CAPABILITY_GAP";
      questions.push({ key: `${run.directory}:${result.id}:${number}`, run: run.directory, caseId: result.id, title: result.title,
        number, phase, attempt, category, status, expected, prompt: step?.prompt ?? plannedStep?.prompt ?? null,
        failure: step?.failure ?? null, assertionFailures: failures, message: step?.result?.message ?? null, answer: step?.result?.answer ?? null,
        endToEndMs: step?.endToEndMs ?? null, window: { startedAt: finite(start) ? new Date(start).toISOString() : null,
          endedAt: finite(end) ? new Date(end).toISOString() : null, basis: explicitStart !== null ? "recorded step clock" : finite(start) ? "estimated from first network turn and relative browser offset" : "unavailable" },
        nativeTurns: turns.length, observations: observations.map(item => ({ kind: item.request.kind, durationMs: item.durationMs, request: item.request, error: item.error ?? null })),
        operations: step?.result?.operations ?? [], artifact: recorded?.artifact ?? null,
        notRunReason: !step ? run.fixtureOnly ? "Fixture preparation only; no model request was sent." : "No step artifact; a prerequisite may have failed or the run may be incomplete." : null });
    }
  }
  return { questions, caseResults };
}

/** An explicit evidence annotation never rewrites the recorded test outcome. */
function annotateTrials(annotations, questions, caseResults) {
  assert(annotations.schemaVersion === 1 && Array.isArray(annotations.trials), "Invalid annotation document; expected schemaVersion 1 and trials array");
  const seen = new Set();
  for (const annotation of annotations.trials) {
    assert(typeof annotation.run === "string" && path.isAbsolute(annotation.run), "Annotation run must be an absolute directory");
    assert(Number.isInteger(annotation.step) && annotation.step > 0, "Annotation step must be a positive integer");
    assert(validities.slice(1).includes(annotation.classification), "Unknown annotation classification");
    assert(typeof annotation.reason === "string" && annotation.reason.trim(), "Annotation reason is required");
    assert(Array.isArray(annotation.evidence) && annotation.evidence.length, "Annotation evidence is required");
    const key = `${path.resolve(annotation.run)}:${annotation.caseId}:${annotation.step}`;
    assert(!seen.has(key), `Duplicate annotation for ${key}`);
    seen.add(key);
    const question = questions.find(item => item.key === key);
    assert(question && !["NOT_RUN", "FIXTURE_READY"].includes(question.status), `Annotation does not identify an executed trial: ${key}`);
    if (annotation.endedAt) assert.equal(question.window.endedAt, annotation.endedAt, `Annotation timestamp mismatch for ${key}`);
    question.annotation = annotation;
  }
  for (const question of questions) {
    question.validity = question.annotation?.classification ?? "valid";
    question.qualityEligible = question.validity === "valid" && ["PASS", "FAIL", "CAPABILITY_GAP"].includes(question.status);
    question.assessedStatus = question.status;
  }
  for (const review of annotations.adjudications ?? []) {
    const question = questions.find(item => item.run === review.run && item.caseId === review.caseId && item.number === review.step);
    assert(question?.qualityEligible && ["FAIL", "PASS", "CAPABILITY_GAP"].includes(review.status), "Adjudication must identify a valid executed trial");
    assert(review.reason?.trim() && review.evidence?.length && !question.adjudication, "Adjudication requires evidence and cannot be duplicated");
    if (review.endedAt) assert.equal(question.window.endedAt, review.endedAt, "Adjudication timestamp mismatch");
    question.adjudication = review;
    question.assessedStatus = review.status;
  }
  for (const result of caseResults) {
    const steps = questions.filter(question => question.run === result.run && question.caseId === result.id);
    if (result.phase === "infrastructure-recovery") {
      assert(questions.some(question => question.caseId === result.id && question.phase === "first-pass"
        && question.validity === "infrastructure-interrupted"), `Recovery ${result.id} has no confirmed interrupted first-pass trial`);
      assert(!questions.some(question => question.caseId === result.id && question.phase === "first-pass"
        && question.qualityEligible && question.assessedStatus === "FAIL"), `Recovery ${result.id} also had a valid first-pass failure; designate it a semantic retest instead`);
    }
    result.validity = steps.some(question => question.validity === "under-investigation") ? "under-investigation"
      : steps.some(question => question.validity === "infrastructure-interrupted") ? "infrastructure-interrupted"
      : steps.some(question => question.validity === "provider-allowance-blocked") ? "provider-allowance-blocked" : "valid";
    result.assessedStatus = steps.some(question => question.qualityEligible && question.assessedStatus === "FAIL") ? "FAIL" : result.status;
    result.qualityEligible = result.validity === "valid" && ["PASS", "FAIL", "CAPABILITY_GAP"].includes(result.status);
  }
  for (const annotation of annotations.caseChecks ?? []) {
    assert(annotation.check === "browser-verification" && validities.slice(1).includes(annotation.classification), "Invalid case-check annotation");
    assert(annotation.reason?.trim() && annotation.evidence?.length, "Case-check reason and evidence are required");
    const result = caseResults.find(item => item.run === annotation.run && item.id === annotation.caseId);
    assert(result?.browserVerification, "Case-check annotation has no recorded browser verification");
    assert(!result.annotation, "Duplicate case-check annotation");
    result.annotation = annotation;
    result.validity = annotation.classification;
    result.qualityEligible = false;
  }
}

function environmentContext(annotations, runs) {
  const environment = annotations.environment ?? null;
  if (environment) for (const field of ["testedProvider", "transport", "normalBetaProvider", "speedCaveat"])
    assert(typeof environment[field] === "string" && environment[field].trim(), `Environment ${field} is required`);
  const contexts = annotations.runContexts ?? [];
  assert(Array.isArray(contexts), "runContexts must be an array");
  const seen = new Set();
  for (const context of contexts) {
    assert(runs.some(run => run.directory === context.run), `Run context references a run that is not included: ${context.run}`);
    assert(!seen.has(context.run), `Duplicate run context: ${context.run}`);
    seen.add(context.run);
    for (const field of ["provider", "bridgeVariant", "purpose"])
      assert(typeof context[field] === "string" && context[field].trim(), `Run context ${field} is required`);
  }
  return { environment, contexts };
}

function qualityCounts(rows) {
  const eligible = rows.filter(row => row.qualityEligible);
  return { eligibleTrials: eligible.length, outcomes: counts(eligible.map(row => ({ ...row, status: row.assessedStatus }))),
    infrastructureInterrupted: rows.filter(row => row.validity === "infrastructure-interrupted").length,
    underInvestigation: rows.filter(row => row.validity === "under-investigation").length,
    providerAllowanceBlocked: rows.filter(row => row.validity === "provider-allowance-blocked").length,
    notRun: rows.filter(row => row.status === "NOT_RUN").length,
    fixtureOnly: rows.filter(row => row.status === "FIXTURE_READY").length };
}

function latencyGroups(questions, successfulOnly = false) {
  const eligible = questions.filter(question => finite(question.endToEndMs)
    && !["NOT_RUN", "FIXTURE_READY"].includes(question.status)
    && (!successfulOnly || question.qualityEligible && question.assessedStatus === "PASS"));
  const keys = new Map(eligible.map(question => [JSON.stringify([question.run, question.phase, question.category, question.validity, question.provider]), question]));
  return [...keys.values()].map(({ run, phase, category, validity, provider }) => {
    const rows = eligible.filter(question => question.run === run && question.phase === phase && question.category === category
      && question.validity === validity && question.provider === provider);
    return { run, phase, category, validity, provider, statuses: counts(rows.map(row => ({ ...row, status: row.assessedStatus }))),
      rawStatuses: counts(rows), ...distribution(rows.map(row => row.endToEndMs)) };
  });
}

function relayData(raw, questions) {
  assert(Array.isArray(raw), "Relay metrics must be a JSON array");
  const seen = new Set();
  const events = raw.map(event => {
    assert(event.relayId && !seen.has(event.relayId), "Relay metric IDs must be present and unique");
    seen.add(event.relayId);
    const dispatched = milliseconds(event.dispatchedAt), completed = milliseconds(event.completedAt);
    const candidates = event.taskPrompt && finite(dispatched) && finite(completed)
      ? questions.filter(question => question.prompt === event.taskPrompt && question.phase !== "fixture"
        && finite(milliseconds(question.window.startedAt)) && finite(milliseconds(question.window.endedAt))
        && dispatched >= milliseconds(question.window.startedAt) - 250 && completed <= milliseconds(question.window.endedAt) + 250) : [];
    const matched = candidates.length === 1 ? candidates[0] : null;
    return { relayId: event.relayId, taskPrompt: event.taskPrompt ?? null, endpointId: event.endpointId ?? null, model: event.model ?? null,
      operation: event.operation ?? null, status: event.status ?? null, dispatchedAt: finite(dispatched) ? new Date(dispatched).toISOString() : null,
      completedAt: finite(completed) ? new Date(completed).toISOString() : null, bridgeWaitMs: event.bridgeWaitMs ?? null, mcpWallMs: event.mcpWallMs ?? null,
      provider: event.provider ?? {}, usage: event.usage ?? {}, questionKey: matched?.key ?? null, category: matched?.category ?? "unmatched",
      phase: matched?.phase ?? "unmatched", run: matched?.run ?? null, validity: matched?.validity ?? "unmatched",
      inferenceProvider: matched?.provider ?? event.model ?? event.endpointId ?? "unrecorded",
      requestOutcome: matched?.assessedStatus ?? "unmatched", rawRequestOutcome: matched?.status ?? "unmatched",
      matching: matched ? `exact taskPrompt and unique wall window (${matched.window.basis})` : !event.taskPrompt ? "no taskPrompt recorded" : candidates.length > 1 ? "ambiguous overlapping question windows" : "no matching prompt and wall window" };
  });
  const groups = [];
  const groupKeys = new Map(events.map(event => [JSON.stringify([event.run, event.phase, event.category, event.validity, event.inferenceProvider, event.requestOutcome]), event]));
  for (const { run, phase, category, validity, inferenceProvider, requestOutcome } of groupKeys.values()) {
    const group = events.filter(event => event.run === run && event.phase === phase && event.category === category && event.validity === validity
      && event.inferenceProvider === inferenceProvider && event.requestOutcome === requestOutcome);
    const byJob = new Map();
    for (const event of group) if (event.provider.jobId) {
      const prior = byJob.get(event.provider.jobId) ?? { provider: {}, usage: {} };
      byJob.set(event.provider.jobId, { provider: { ...prior.provider, ...event.provider }, usage: { ...prior.usage, ...event.usage } });
    }
    const jobs = [...byJob.values()];
    const costValues = jobs.map(job => job.provider.cost).filter(finite);
    const promptTokens = jobs.map(job => job.usage.prompt_tokens).filter(finite);
    const completionTokens = jobs.map(job => job.usage.completion_tokens).filter(finite);
    groups.push({ run, phase, category, validity, inferenceProvider, requestOutcome,
      relayCalls: group.length, identifiedProviderJobs: jobs.length,
      bridgeWait: distribution(group.map(event => event.bridgeWaitMs)), mcpWall: distribution(group.map(event => event.mcpWallMs)),
      providerExecution: distribution(jobs.map(job => job.provider.executionMs)), providerQueue: distribution(jobs.map(job => job.provider.queueMs)),
      recordedCost: costValues.length ? sum(costValues) : null, jobsWithCost: costValues.length,
      promptTokens: promptTokens.length ? sum(promptTokens) : null, jobsWithPromptTokens: promptTokens.length,
      completionTokens: completionTokens.length ? sum(completionTokens) : null, jobsWithCompletionTokens: completionTokens.length });
  }
  return { matchingPolicy: "Exact taskPrompt plus dispatch/completion contained in one step wall window, with 250 ms clock tolerance. Ambiguous or missing matches remain separate. No latency is subtracted and overlapping jobs are never added into a pretend wall time.",
    events, groups, measurementUnits: "Bridge/MCP timings count relay calls, including polls. Provider execution, queue, tokens and cost count distinct recorded job IDs within each group; repeated status polls do not become extra jobs. Missing provider metadata remains unknown.",
    costUnit: "Provider-reported cost units, deduplicated by job ID within each group; currency is not recorded by this relay schema." };
}

export async function generateAcceptanceReport(options) {
  const [runs, capabilities, reliability, relay, annotations, audioInvestigation, playbackReplay] = await Promise.all([
    Promise.all(options.runs.map(directory => readRun(directory, options))), jsonFile(options.capabilities), jsonFile(options.reliability),
    options["relay-metrics"] ? jsonFile(options["relay-metrics"]) : [],
    options.annotations ? jsonFile(options.annotations) : { schemaVersion: 1, trials: [] },
    options["audio-investigation"] ? jsonFile(options["audio-investigation"]) : null,
    options["playback-replay"] ? jsonFile(options["playback-replay"]) : null,
  ]);
  if (playbackReplay) assert(playbackReplay.noNewAiCalls === true && Array.isArray(playbackReplay.assistantRequests)
    && playbackReplay.assistantRequests.length === 0, "Playback replay must record zero new assistant requests");
  runs.sort((left, right) => (milliseconds(left.startedAt) ?? 0) - (milliseconds(right.startedAt) ?? 0));
  const { questions, caseResults } = questionsFrom(runs);
  annotateTrials(annotations, questions, caseResults);
  const execution = environmentContext(annotations, runs);
  for (const question of questions) question.provider = execution.contexts.find(context => context.run === question.run)?.provider ?? "Provider not recorded for this run";
  const phases = [...new Set(questions.map(question => question.phase))];
  const latency = latencyGroups(questions);
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(),
    totals: { plannedRequestRecords: questions.length, executedRequestAttempts: questions.filter(question => ["PASS", "FAIL", "CAPABILITY_GAP"].includes(question.status)).length,
      caseAttemptRecords: caseResults.length, distinctCaseIds: new Set(caseResults.map(result => result.id)).size },
    sources: { runs: options.runs, capabilities: options.capabilities, reliability: options.reliability,
      relayMetrics: options["relay-metrics"] ?? null, annotations: options.annotations ?? null,
      audioInvestigation: options["audio-investigation"] ?? null, playbackReplay: options["playback-replay"] ?? null },
    methodology: {
      outcomes: "Each executed question retains its actual prompt, response and failed assertions. A verified honest refusal is CAPABILITY_GAP, not a working feature. Missing steps are NOT_RUN. Fixture-only runs are not live tests.",
      counts: "Case aggregates count run/case attempts, not unique capabilities or unique case definitions. Question aggregates count individual user-request attempts; a multi-request case is not one latency sample. Distinct case IDs are reported separately and do not imply all of those cases passed.",
      attempts: "First-pass is the earliest supplied non-preliminary, non-fixture primary attempt for a case. Explicit semantic --retests and clean --recoveries after confirmed infrastructure interruptions are separate. Other repeated primary runs remain labelled repeats. No successful retry erases an earlier failure.",
      validity: "Only explicit, evidence-backed annotations exclude trials from conclusive quality. Confirmed infrastructure interruptions and unresolved investigations remain in raw outcomes and separate timing groups. Evidence-reviewed adjudications affect assessed quality and successful latency, while raw automated outcomes stay unchanged. Unrun prerequisites are never passes. Recovery is permitted only for a case with an interrupted first pass and no valid first-pass failure; this report does not independently verify source equivalence between runs.",
      latency: "Nearest-rank p50/p90/max of recorded per-question end-to-end time. Valid failures and gap requests are included; interrupted or unresolved trials have separate groups. Media cases/observations are media; other requested edits are edit; read-only/refusal requests are question. Preliminary and repeat groups are separate.",
      limits: "End-to-end includes actual browser extraction, validation, API, provider time and external relay/operator lag. Native turns are not provider inference calls. Model-task playback/export host effects are recorded, not executed. Separate browser verification is reported only where its result was recorded and is outside per-question latency. Static capability support does not imply a live model acceptance pass.",
    },
    runs: runs.map(({ cases, ...run }) => ({ ...run, caseCount: cases.length })),
    qualityByPhase: phases.map(phase => ({ phase, questions: qualityCounts(questions.filter(question => question.phase === phase)),
      cases: qualityCounts(caseResults.filter(result => result.phase === phase)) })),
    qualityByRun: runs.map(run => ({ run: run.directory, phase: questions.find(question => question.run === run.directory)?.phase ?? run.designation,
      questions: qualityCounts(questions.filter(question => question.run === run.directory)),
      cases: qualityCounts(caseResults.filter(result => result.run === run.directory)) })),
    countsByPhase: phases.map(phase => ({ phase, questions: counts(questions.filter(question => question.phase === phase)), cases: counts(caseResults.filter(result => result.phase === phase)) })),
    execution, annotations, audioInvestigation, playbackReplay, caseResults, questions, latency,
    successfulLatency: latencyGroups(questions, true), relay: relayData(relay, questions),
    staticCoverage: { assessmentType: capabilities.assessment_type, definitions: capabilities.definitions, summary: capabilities.summary, capabilities: capabilities.capabilities, validation: capabilities.validation },
    reliability,
  };
  await mkdir(options.output, { recursive: true });
  await writeFile(path.join(options.output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(path.join(options.output, "index.html"), renderReport(report, options.output));
  return report;
}

const seconds = value => finite(value) ? `${(value / 1000).toFixed(2)} s` : "—";
const badge = value => `<span class="badge ${escape(value.toLowerCase().replace(/[^a-z]/g, "-"))}">${escape(value)}</span>`;
const code = value => `<pre>${escape(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre>`;
const table = (headers, rows, attributes = "") => `<div class="scroll"><table ${attributes}><thead><tr>${headers.map(item => `<th>${item}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${headers.length}">No recorded data.</td></tr>`}</tbody></table></div>`;
const row = cells => `<tr>${cells.map(cell => `<td>${cell}</td>`).join("")}</tr>`;

function evidenceUrl(file, output) {
  const relative = path.relative(output, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.split(path.sep).map(encodeURIComponent).join("/") : pathToFileURL(file).href;
}

function evidenceLinks(evidence, output) {
  return `<ul>${(evidence ?? []).map(item => `<li><a href="${escape(evidenceUrl(item.file, output))}">${escape(path.basename(item.file))}</a>${item.line ? `:${escape(item.line)}` : ""} — ${escape(item.excerpt ?? "")}</li>`).join("")}</ul>`;
}

function renderAudioInvestigation(investigation, output) {
  if (!investigation) return "";
  const trials = investigation.asrTrials ?? [];
  return `<h2>Controlled audio investigation</h2><p class="note">${escape(investigation.finding)}</p>
    <p>${escape(investigation.scope)}</p>
    ${table(["Condition", "Language hint / detection", "Transcript", "Aligned words", "Setup end", "Answer onset"], trials.map(trial => row([
      escape(trial.id), escape(`${trial.requestedLanguage ?? "auto"} / ${trial.detectedLanguage ?? "unknown"}`), escape(trial.text),
      trial.wordCount, finite(trial.setupEndSeconds) ? `${trial.setupEndSeconds.toFixed(3)} s` : "Unresolved",
      finite(trial.answerOnsetSeconds) ? `${trial.answerOnsetSeconds.toFixed(3)} s` : "Unresolved",
    ])))}
    <details><summary>Waveform measurements, interpretation and limits</summary>${code({ browserExtraction: investigation.browserExtraction,
      observedContrasts: investigation.observedContrasts, limitations: investigation.limitations })}</details>
    <p>${escape(investigation.changesMade)}</p><ul>${(investigation.recommendations ?? []).map(item => `<li>${escape(item)}</li>`).join("")}</ul>
    <details><summary>Original audio and diagnostic evidence</summary><ul>${(investigation.artifacts ?? []).map(item =>
      `<li><a href="${escape(evidenceUrl(item.path, output))}">${escape(item.role)}</a> — ${escape(item.path)}</li>`).join("")}</ul></details>`;
}

function renderReport(report, output) {
  const summary = report.staticCoverage.summary ?? {};
  const ordinary = summary.ordinary_available_manual_edit_counts ?? {};
  const all = summary.support_counts ?? {};
  const countText = values => Object.entries(values).map(([name, value]) => `${value} ${name}`).join(" · ");
  const phaseOptions = [...new Set(report.questions.map(question => question.phase))];
  const controls = `<div class="filters">
    <label>Search prompts <input id="search" type="search" placeholder="Prompt, answer, failure…"></label>
    <label>Raw outcome <select id="status"><option value="">All outcomes</option>${statuses.map(status => `<option>${status}</option>`).join("")}</select></label>
    <label>Attempt <select id="phase"><option value="">All attempts</option>${phaseOptions.map(phase => `<option>${escape(phase)}</option>`).join("")}</select></label>
    <label>Category <select id="category"><option value="">All categories</option><option>question</option><option>edit</option><option>media</option></select></label>
    <label>Trial validity <select id="validity"><option value="">All trials</option>${validities.map(validity => `<option>${validity}</option>`).join("")}</select></label>
    <span id="visible" aria-live="polite"></span></div>`;
  const questionRows = report.questions.map(question => {
    const jobs = report.relay.events.filter(event => event.questionKey === question.key);
    return `<tr data-status="${escape(question.status)}" data-phase="${escape(question.phase)}" data-category="${escape(question.category)}" data-validity="${escape(question.validity)}">
      <td>${badge(question.status)}<p>${escape(question.phase)}</p>${question.validity !== "valid" ? badge(question.validity) : ""}${question.adjudication ? `<p>Evidence review: ${badge(question.assessedStatus)}</p>` : ""}</td>
      <td><strong>${escape(question.caseId)} / ${question.number}</strong><p>${escape(question.title)}</p>
      ${question.annotation ? `<p class="note">${escape(question.annotation.reason)} — excluded from conclusive quality.</p><details><summary>Classification evidence</summary>${evidenceLinks(question.annotation.evidence, output)}${code(question.annotation)}</details>` : ""}
      ${question.adjudication ? `<p class="note">${escape(question.adjudication.reason)}</p><details><summary>Adjudication evidence</summary>${evidenceLinks(question.adjudication.evidence, output)}${code(question.adjudication)}</details>` : ""}
      <details><summary>${escape(question.prompt?.slice(0, 150) ?? "Prompt not recorded")}${question.prompt?.length > 150 ? "…" : ""}</summary>
      <h4>Full prompt</h4>${code(question.prompt ?? "No prompt artifact was recorded.")}
      <h4>Actual response</h4>${code([question.message, question.answer].filter(Boolean).join("\n\n") || question.notRunReason || "No final response.")}
      ${question.failure ? `<h4>Request failure</h4>${code(question.failure)}` : ""}
      <h4>Failed assertions</h4>${question.assertionFailures.length ? code(question.assertionFailures) : "<p>None recorded for this step.</p>"}
      <h4>Prepared operations</h4>${code(question.operations)}<h4>Media observations</h4>${code(question.observations)}
      <h4>Artifact</h4>${question.artifact ? `<a href="${escape(evidenceUrl(question.artifact, output))}">Original step JSON</a>` : ""}${code(question.artifact ?? question.run)}</details></td>
      <td>${escape(question.category)}<p>${seconds(question.endToEndMs)}</p><small>${question.nativeTurns} native turns · ${question.observations.length} observations</small></td>
      <td>${jobs.length} matched relay calls<details><summary>Timing details</summary>${code(question.window)}${code(jobs.map(({ taskPrompt, ...event }) => event))}</details></td></tr>`;
  });
  const latencyRows = report.latency.filter(group => group.validity === "valid")
    .map(group => row([escape(group.provider), escape(`${group.phase} / ${path.basename(group.run)}`), escape(group.category), group.count, seconds(group.p50Ms), seconds(group.p90Ms), seconds(group.maxMs), escape(countText(group.statuses))]));
  const successfulLatencyRows = report.successfulLatency.map(group => row([escape(group.provider), escape(`${group.phase} / ${path.basename(group.run)}`), escape(group.category),
    group.count, seconds(group.p50Ms), seconds(group.p90Ms), seconds(group.maxMs)]));
  const excludedLatencyRows = report.latency.filter(group => group.validity !== "valid")
    .map(group => row([escape(`${group.phase} / ${path.basename(group.run)} / ${group.category}`), escape(group.validity), group.count, seconds(group.p50Ms), seconds(group.p90Ms), seconds(group.maxMs)]));
  const relayRows = report.relay.groups.map(group => row([escape(`${group.inferenceProvider}: ${group.phase} / ${group.run ? path.basename(group.run) : "unmatched"} / ${group.category}`), escape(`${group.validity} / ${group.requestOutcome}`), group.relayCalls, group.identifiedProviderJobs,
    seconds(group.bridgeWait.p50Ms), seconds(group.providerQueue.p50Ms), seconds(group.providerExecution.p50Ms), seconds(group.mcpWall.p50Ms),
    finite(group.recordedCost) ? `${group.recordedCost.toFixed(6)} (${group.jobsWithCost}/${group.identifiedProviderJobs} jobs)` : "—"]));
  const capabilityRows = (report.staticCoverage.capabilities ?? []).map(item => row([
    `<strong>${escape(item.id)}</strong><p>${escape(item.manual_capability)}</p>`, badge(item.ai_support), escape(item.boundary),
    `<details><summary>Tools and limitations</summary><p>${escape((item.native_operations_or_observations ?? []).join(", ") || "No native tool")}</p>${code({ missingTools: item.missing_tool, missingContext: item.missing_context, limitations: item.limitations_and_reasoning })}</details>`,
  ]));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PVO AI acceptance report</title>
<style>
:root{font:16px/1.5 system-ui,sans-serif;color:#20262f;background:#f5f7f9}body{max-width:1440px;margin:auto;padding:32px}h1,h2,h3{line-height:1.2}h2{margin-top:36px}p{margin:8px 0}a{color:#155ac4}small,.muted{color:#566271}.note{border-left:4px solid #476ba0;padding:12px 16px;background:#eaf0f8}.scroll{overflow:auto;background:white;border:1px solid #dbe0e6;border-radius:8px}table{border-collapse:collapse;width:100%;text-align:left}th,td{padding:12px;border-bottom:1px solid #e3e7ed;vertical-align:top}th{background:#eef1f5;white-space:nowrap}td{min-width:80px}#questions td:nth-child(2){width:60%;min-width:280px}tr[hidden]{display:none}.badge{display:inline-block;border-radius:5px;padding:2px 7px;background:#e9edf3;font-size:13px;font-weight:650}.pass,.full{color:#146137;background:#def4e6}.fail,.missing{color:#8e2323;background:#fbe2e2}.capability-gap,.partial{color:#795315;background:#fff0c9}.filters{display:flex;align-items:end;gap:16px;flex-wrap:wrap;margin:20px 0}.filters label{display:grid;gap:4px}input,select{font:inherit;padding:8px;border:1px solid #aeb8c6;border-radius:5px;background:white}summary{cursor:pointer;color:#225ba0;overflow-wrap:anywhere}details{margin:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:480px;overflow:auto;padding:12px;background:#f2f4f7;border-radius:5px;font:13px/1.55 ui-monospace,monospace}h4{margin-bottom:6px}@media(max-width:700px){body{padding:16px}th,td{padding:9px}.filters label{width:100%}}@media print{.filters{display:none}body{max-width:none;padding:0}.scroll{overflow:visible}pre{max-height:none}}
</style></head><body>
<h1>PVO AI acceptance report</h1><p class="muted">Generated ${escape(report.generatedAt)} · <a href="report.json">Machine-readable report</a></p>
<p>${report.totals.executedRequestAttempts} executed request attempts out of ${report.totals.plannedRequestRecords} planned request records; ${report.totals.caseAttemptRecords} case-attempt records across ${report.totals.distinctCaseIds} distinct case IDs. These are test counts, not pass or capability-coverage claims.</p>
${report.execution.environment ? `<div class="note"><strong>Inference environment</strong>
<p>${escape(report.execution.environment.testedProvider)} — ${escape(report.execution.environment.transport)}</p>
<p>${escape(report.execution.environment.normalBetaProvider)}</p><p><strong>${escape(report.execution.environment.speedCaveat)}</strong></p></div>` : "<p class=\"note\">Provider/transport environment was not supplied; do not assume these timings describe the normal beta route.</p>"}
${report.execution.contexts.length ? table(["Run", "Provider", "Bridge variant", "Purpose"], report.execution.contexts.map(context => row([
  escape(context.run), escape(context.provider), escape(context.bridgeVariant), escape(context.purpose),
]))) : ""}
${report.annotations.oracleChanges?.length ? `<details open><summary>Test calibration and oracle changes</summary>${code(report.annotations.oracleChanges)}</details>` : ""}
<p class="note">Live outcomes, static tool coverage and deterministic safeguards are separate evidence. A capability marked “full” below has a native contract; it has not necessarily passed a real model request. Successful retests do not replace first-pass failures.</p>
${report.annotations.releaseGates?.length ? `<h2>Unresolved release findings</h2>${table(["Finding", "Observed result", "Required next evidence"], report.annotations.releaseGates.map(gate => row([
  escape(gate.title), `${escape(gate.finding)}${evidenceLinks(gate.evidence, output)}`, escape(gate.nextEvidence),
])))}` : ""}
<h2>Conclusive request quality</h2><p>Only valid, executed trials enter the outcome columns. Evidence-reviewed corrections supersede superficial automated assertions here; the raw result remains below. Confirmed infrastructure interruptions, unresolved investigations, provider allowance rejections and unrun requests are shown separately; none becomes a pass. Infrastructure recovery and semantic retests remain separate from the first pass.</p>
${table(["Attempt group / run", "Eligible requests", "Pass", "Fail", "Capability gap", "Infrastructure", "Investigating", "Allowance blocked", "Not run"], report.qualityByRun.map(({ run, phase, questions }) => row([
  escape(`${phase} / ${path.basename(run)}`), questions.eligibleTrials, questions.outcomes.PASS, questions.outcomes.FAIL, questions.outcomes.CAPABILITY_GAP,
  questions.infrastructureInterrupted, questions.underInvestigation, questions.providerAllowanceBlocked, questions.notRun,
])))}
<details><summary>Case-level conclusive quality by run</summary>${code(report.qualityByRun.map(({ run, phase, cases }) => ({ run, phase, ...cases })))}</details>
<h2>All raw attempts</h2><p>These are the unchanged test outcomes, including infrastructure failures. Repeated case attempts are counted separately.</p>${table(["Attempt group", "Request-attempt outcomes", "Case-attempt outcomes"], report.countsByPhase.map(group => row([escape(group.phase), escape(countText(group.questions)), escape(countText(group.cases))])))}
<details><summary>Run provenance and measurement rules</summary>${code(report.runs)}${code(report.methodology)}</details>
${report.caseResults.some(result => result.browserVerification) ? `<details open><summary>Recorded browser interaction verification</summary>${table(["Case / attempt", "Recorded result", "Timing scope"], report.caseResults.filter(result => result.browserVerification).map(result => row([
  escape(`${result.id} / ${result.phase}`), code({ result: result.browserVerification, annotation: result.annotation ?? null }), "Included in case wall time; excluded from model-request latency. Earlier runs without this record do not inherit its result.",
])))}</details>` : ""}
${report.playbackReplay ? `<h2>Saved-model playback replay</h2><p>${badge(report.playbackReplay.status)} — Replay wall time ${seconds(report.playbackReplay.durationMs)}. This exercises the saved model result with expired media URLs rebound; it makes no new AI request and contributes no model trial, case-attempt or inference-latency sample. It verifies the explicitly requested 2-second quiz hold and response behavior, not autonomous selection of the correct speech boundary.</p>
${evidenceLinks([{ file: report.sources.playbackReplay, excerpt: "Complete replay summary with source hashes and URL rebinding." },
  { file: path.join(path.dirname(report.sources.playbackReplay), "browser-verification.json"), excerpt: "Actual desktop/mobile held-state and response events." },
  { file: path.join(path.dirname(report.sources.playbackReplay), "final.png"), excerpt: "Rendered final replay state." }], output)}
<details><summary>Exact replay evidence</summary>${code(report.playbackReplay)}</details>` : ""}
${report.caseResults.some(result => result.failures.length) ? `<details open><summary>Case-level failures, including infrastructure</summary>${code(report.caseResults.filter(result => result.failures.length))}</details>` : ""}
<h2>Every request</h2><p>Expand a row for the exact prompt, actual answer, failed assertions and tool results. CAPABILITY_GAP means the unavailable action was honestly declined; it is not a feature pass.</p>${controls}${table(["Outcome / attempt", "Request and evidence", "End-to-end", "Relay matching"], questionRows, 'id="questions"')}
<h2>Successful completed request latency</h2><p>Only valid PASS requests enter this table. Failures and capability-gap refusals cannot make editing speed look faster. Measured browser wall time includes media work and external relay/operator waiting; it is not a direct production benchmark. Providers and attempt groups remain separate.</p>${table(["Provider", "Attempt group", "Category", "Requests", "p50", "p90", "Max"], successfulLatencyRows)}
<details><summary>All valid-trial end-to-end latency, including failures and gaps</summary><p>Nearest-rank percentiles; small samples are not benchmarks.</p>${table(["Provider", "Attempt group", "Category", "Requests", "p50", "p90", "Max", "Outcomes"], latencyRows)}</details>
<details><summary>Interrupted, unresolved and rejected request latency</summary><p>Provider allowance rejections have no model response: their short request times are not inference speed.</p>${table(["Attempt group / category", "Classification", "Requests", "p50", "p90", "Max"], excludedLatencyRows)}</details>
<h2>Provider and relay timing</h2><p>${escape(report.relay.matchingPolicy)}</p><p>${escape(report.relay.measurementUnits)}</p><p>Provider execution, provider queue, MCP wall time and bridge/operator waiting may overlap. Their sums are not the request wall time. ${escape(report.relay.costUnit)}</p>${table(["Matched group", "Validity", "Relay calls", "Identified jobs", "Bridge wait p50", "Provider queue p50", "Execution p50", "MCP wall p50", "Recorded cost"], relayRows)}
<details><summary>Every relay job, usage and complete timing distributions</summary>${code(report.relay)}</details>
${renderAudioInvestigation(report.audioInvestigation, output)}
<h2>Static capability coverage</h2><p><strong>${sum(Object.values(ordinary).filter(finite))} ordinary available manual edits</strong>: ${escape(countText(ordinary))}.</p><p><strong>${escape(summary.capabilities ?? report.staticCoverage.capabilities?.length ?? 0)} groups across the entire inventory</strong>: ${escape(countText(all))}. The broader inventory includes adjacent workflows and intentional access boundaries. Neither denominator is the number of live test cases.</p><details><summary>Coverage definitions and audit provenance</summary>${code({ assessment: report.staticCoverage.assessmentType, definitions: report.staticCoverage.definitions, validation: report.staticCoverage.validation })}</details>${table(["Capability", "Static support", "Boundary", "Evidence limits"], capabilityRows)}
<h2>Deterministic reliability checks</h2>${table(["Check", "Result", "Evidence"], (report.reliability.checks ?? []).map(check => row([escape(check.name), escape(check.expectedFailure ? `Expected red proof: ${check.failed} failures` : check.status ?? `${check.passed}/${check.tests} passed`), escape(check.log ?? check.command)])))}
<details><summary>Fixes and tested invariants</summary>${code({ fixes: report.reliability.fixes, testedCoverage: report.reliability.testedCoverage })}</details>
<h2>Unverified risks</h2>${table(["Area", "Status", "Remaining evidence"], (report.reliability.unverifiedOrResidualRisks ?? []).map(risk => row([escape(risk.area), escape(risk.status), `${escape(risk.risk)}<p>${escape(risk.nextEvidence ?? "")}</p>`])))}
<details><summary>Source-based latency findings; not live benchmarks</summary>${code(report.reliability.latencyAnalysis)}</details>
<script>
const filters = ['search', 'status', 'phase', 'category', 'validity'].map(id => document.getElementById(id));
const rows = [...document.querySelectorAll('#questions tbody tr[data-status]')];
function filterRows() {
  const [search, status, phase, category, validity] = filters.map(input => input.value.toLowerCase());
  let visible = 0;
  for (const row of rows) {
    row.hidden = Boolean((search && !row.textContent.toLowerCase().includes(search)) || (status && row.dataset.status.toLowerCase() !== status) || (phase && row.dataset.phase.toLowerCase() !== phase) || (category && row.dataset.category !== category) || (validity && row.dataset.validity !== validity));
    if (!row.hidden) visible++;
  }
  document.getElementById('visible').textContent = visible + ' / ' + rows.length + ' requests';
}
for (const input of filters) input.addEventListener('input', filterRows);
filterRows();
</script></body></html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = optionsFrom(process.argv.slice(2));
    if (!options) console.log(usage);
    else {
      const report = await generateAcceptanceReport(options);
      console.log(JSON.stringify({ output: options.output, ...report.totals, relayCalls: report.relay.events.length }));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
