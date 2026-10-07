/** Compare useful evidence, excluding receipt IDs, source revision counters and observation times. */
export function batchProgressEvidence(state) {
  if (!["completed", "failed"].includes(state.batchEnd)) return null;
  const observations = [];
  for (const [index, tool] of state.decision.calls.entries()) {
    const feedback = state.feedback.find(
      (item) => item.operationId === `build-${state.round}-${index}`,
    );
    if (!feedback) {
      // A failed call abandons the remaining dependent calls. Missing earlier evidence cannot prove a loop.
      if (observations.length && state.batchEnd === "failed") break;
      return null;
    }
    if (
      ["workspace_capacity", "workspace_allowance"].includes(
        feedback.result?.result?.code,
      )
    )
      return null;
    const {
      revision: _revision,
      expectedRevision: _expected,
      files: _files,
      ...request
    } = tool;
    let result = structuredClone(feedback.result);
    if (!result || typeof result !== "object") return null;
    if (tool.kind === "web_evidence") {
      // Rewording an interpretation or reciting a newer receipt is not new external evidence.
      observations.push({
        request: { kind: tool.kind },
        result: {
          status: result.status,
          source: result.result
            ? {
                url: result.result.source.url,
                truncated: result.result.source.truncated,
              }
            : null,
        },
      });
      continue;
    }
    if (["web_read", "web_search"].includes(tool.kind)) {
      if (result.result) delete result.result.retrievedAt;
    } else if (["workspace_list", "workspace_read"].includes(tool.kind)) {
      delete result.revision;
    } else {
      // Receipt.digest hashes the request identity, not its source; result.digest is the saved source digest.
      result = {
        kind: result.kind ?? null,
        status: result.status,
        result: result.result,
      };
      if (
        ["save", "start"].includes(result.kind) &&
        result.status === "completed"
      ) {
        delete result.result.revision;
        delete result.result.deadlineAt;
      }
    }
    observations.push({ request, result });
  }
  if (!observations.length) return null;
  return { agreement: state.agreement?.digest ?? null, observations };
}

export function reviewProgressEvidence(state, report, error) {
  if (report?.status === "passed") return null;
  const review =
    state.decision.kind === "review" ? state.decision : state.decision.review;
  const { revision: _revision, ...source } = review;
  return { agreement: state.agreement.digest, source, report, error };
}

export function serializeProgressEvidence(value) {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
