/** Explicit development origins; browser storage stays on its original host. */
export function createLocalOriginPolicy(origin, publicOrigin) {
  const local = new URL(origin);
  if (
    local.origin !== origin ||
    local.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(local.hostname)
  )
    throw new Error(
      "Local development requires an exact HTTP loopback origin.",
    );
  const origins = new Set([origin]);
  for (const hostname of ["localhost", "127.0.0.1"]) {
    const alias = new URL(origin);
    alias.hostname = hostname;
    origins.add(alias.origin);
  }
  if (publicOrigin) {
    const publicUrl = new URL(publicOrigin);
    if (publicUrl.protocol !== "https:" || publicUrl.origin !== publicOrigin)
      throw new Error("The phone beta requires an exact HTTPS origin.");
    origins.add(publicOrigin);
  }
  const byHost = new Map(
    [...origins].map((value) => [new URL(value).host, value]),
  );
  function originFor(request) {
    const expected = byHost.get(request.headers.host);
    if (!expected) return null;
    try {
      return new URL(request.url, expected).origin === expected
        ? expected
        : null;
    } catch {
      return null;
    }
  }
  return {
    originFor,
    accepts(request) {
      const expected = originFor(request);
      const site = request.headers["sec-fetch-site"];
      const supplied = request.headers.origin;
      return (
        !!expected &&
        (!site || site === "same-origin" || site === "none") &&
        (supplied === undefined
          ? ["GET", "HEAD"].includes(request.method)
          : supplied === expected)
      );
    },
  };
}
