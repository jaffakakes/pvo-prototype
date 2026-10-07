/** Private diagnostic transport. Credentials never enter a Machine or a report. */
export function flyApi(token, { fetchImpl = fetch } = {}) {
  if (typeof token !== "string" || !token.trim())
    throw new Error("Fly authentication is required.");
  return async function request(
    method,
    path,
    body,
    { timeoutMs = 15000 } = {},
  ) {
    if (!/^\/apps(?:\/[a-zA-Z0-9_/-]+)?(?:\?force=true)?$/.test(path))
      throw new Error("Invalid Fly diagnostic API path.");
    const response = await fetchImpl(`https://api.machines.dev/v1${path}`, {
      method,
      redirect: "error",
      headers: {
        Authorization: `${token.split(",").some((value) => /^(fm1r|fm2)_/.test(value)) ? "FlyV1" : "Bearer"} ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const pieces = [];
    let bytes = 0;
    try {
      for await (const piece of response.body ?? []) {
        bytes += piece.byteLength;
        if (bytes > 2 * 1024 * 1024)
          throw new Error("Fly diagnostic reply exceeded its byte limit.");
        pieces.push(piece);
      }
    } catch (error) {
      await response.body?.cancel().catch(() => {});
      throw error;
    }
    let data = null;
    if (bytes) {
      try {
        data = JSON.parse(Buffer.concat(pieces).toString("utf8"));
      } catch {
        throw new Error(
          `Fly ${method} ${path}: non-JSON reply (${response.status}).`,
        );
      }
    }
    // Provider error bodies may contain source/configuration; never forward them into errors.
    return { ok: response.ok, status: response.status, data };
  };
}

export async function requireFly(request, method, path, body, options) {
  const response = await request(method, path, body, options);
  if (!response.ok)
    throw new Error(`Fly ${method} ${path} failed (${response.status}).`);
  return response.data;
}
