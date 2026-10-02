/** Keep runner bookkeeping out of the strict study HTTP contract. */
export function studyTurnEnvelope(trial, stage, request) {
  return { trialId: trial.trialId, pairId: trial.pairId, replicate: trial.replicate,
    variant: trial.variant, stage, request };
}

/** Study traffic goes only to its dedicated server; the user's beta is never contacted. */
export async function installStudyTransport(context, studyUrl, trial, records, { dryRun = false, phase } = {}) {
  const origin = new URL(studyUrl).origin;
  const active = new Set();
  context.on("close", () => { for (const controller of active) controller.abort(); });
  const handler = async route => {
    const incoming = route.request();
    const pathname = new URL(incoming.url()).pathname;
    if (dryRun) {
      records.push({ path: pathname, denied: "dry_run_provider_request" });
      return route.abort("blockedbyclient");
    }
    const path = pathname === "/__study/turn" ? "/study/turn"
      : pathname === "/api/assistant/transcribe" ? "/study/transcribe" : null;
    if (!path) return route.abort("blockedbyclient");
    const controller = new AbortController();
    active.add(controller);
    const started = performance.now();
    const record = { path, method: incoming.method(), startedAt: new Date().toISOString() };
    records.push(record);
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const incomingHeaders = await incoming.allHeaders();
      const headers = { Accept: "application/json", "x-study-trial": trial.trialId, "x-study-stage": phase };
      for (const name of ["content-type", "x-audio-duration"]) {
        if (incomingHeaders[name]) headers[name] = incomingHeaders[name];
      }
      const response = await fetch(origin + path, {
        method: incoming.method(), headers, redirect: "error", signal: controller.signal,
        ...(incoming.method() === "POST" ? { body: incoming.postDataBuffer() } : {}),
      });
      const body = await response.text();
      record.status = response.status;
      record.responseBytes = Buffer.byteLength(body);
      await route.fulfill({ status: response.status, contentType: "application/json", body });
    } catch (error) {
      record.error = { name: error.name, message: error.message };
      await route.abort("failed").catch(() => {});
    } finally {
      record.durationMs = Math.round(performance.now() - started);
      record.endedAt = new Date().toISOString();
      clearTimeout(timer);
      active.delete(controller);
    }
  };
  await context.route("**/__study/turn", handler);
  await context.route("**/api/assistant/**", handler);
}
