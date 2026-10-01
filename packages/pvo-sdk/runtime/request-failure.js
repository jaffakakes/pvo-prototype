export class RequestHttpError extends Error {
  constructor(status) {
    super(`Request failed with ${status}.`);
    this.name = "RequestHttpError";
    this.status = status;
  }
}

export class RequestPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "RequestPolicyError";
  }
}

export class RequestTimeoutError extends Error {
  constructor() {
    super("The request timed out.");
    this.name = "RequestTimeoutError";
  }
}

/** Viewer-safe request feedback; raw exception messages stay in diagnostics and authored on_error. */
export function describeRequestFailure(error) {
  if (error instanceof RequestHttpError) {
    const status = error.status;
    if (status === 404) return { kind: "http", status, message: "Request not found (404)." };
    if (status === 401 || status === 403) return { kind: "http", status, message: `Access denied (${status}).` };
    if (status === 408) return { kind: "http", status, message: "Service did not respond (408)." };
    if (status === 429) return { kind: "http", status, message: "Too many requests (429). Try again later." };
    if (status >= 500) return { kind: "http", status, message: `Service error (${status}). Try again.` };
    return { kind: "http", status, message: `Request failed (${status}).` };
  }
  if (error instanceof RequestPolicyError) {
    return { kind: "policy", message: "This request is not allowed." };
  }
  if (error instanceof RequestTimeoutError || error?.name === "TimeoutError") {
    return { kind: "timeout", message: "No response from the service. Try again." };
  }
  if (error instanceof TypeError || error?.name === "NetworkError") {
    return { kind: "network", message: "Could not reach the service." };
  }
  return { kind: "unknown", message: "The request could not be completed." };
}
