/** Safe RPC data is consumed by HTTP adapters; generated exceptions and private request data are never exposed. */
export async function hostedReply(operation) {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    const codes = {
      unavailable: 404,
      forbidden: 403,
      invalid_input: 400,
      action_conflict: 409,
      state_changed: 409,
      budget_exceeded: 429,
      busy: 429,
      invalid_result: 502,
    };
    return {
      ok: false,
      status: codes[error?.code] ?? 502,
      error: codes[error?.code]
        ? error.message
        : "This service could not complete the action. Retry the same action.",
    };
  }
}
