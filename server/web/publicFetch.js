import { HttpError } from "../http.js";
import { isPublicAddress, publicHttpsUrl } from "./publicAddress.js";

async function boundedBytes(response, maximum, signal) {
  if (Number(response.headers.get("Content-Length")) > maximum) {
    await response.body?.cancel();
    throw new HttpError(413, "The public resource is too large.");
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let length = 0;
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new HttpError(413, "The public resource is too large.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** Use one fixed public DNS resolver; a failed lookup never bypasses validation. */
async function resolvePublicHost(hostname, { fetch: send, signal }) {
  const addresses = await Promise.all(["A", "AAAA"].map(async type => {
    const url = new URL("https://dns.google/resolve");
    url.search = new URLSearchParams({ name: hostname, type }).toString();
    const response = await send(url.href, { redirect: "manual", credentials: "omit",
      headers: { Accept: "application/dns-json" }, signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(502, "The website's public address could not be verified.");
    }
    let result;
    try { result = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 32768, signal))); }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(502, "The website's public address could not be verified."); }
    if (result.Status !== 0 || !Array.isArray(result.Answer ?? []))
      throw new HttpError(502, "The website's public address could not be verified.");
    const entries = result.Answer ?? [];
    for (const entry of entries) if (entry.type === 5)
      publicHttpsUrl(`https://${String(entry.data).replace(/\.$/, "")}/`);
    return entries.filter(entry => entry.type === 1 || entry.type === 28).map(entry => entry.data);
  }));
  return addresses.flat();
}

/** Public read-only egress: no caller headers/cookies, DNS checks and manual redirects. */
export async function readPublicResource(input, {
  maxBytes = 1024 * 1024, signal, timeoutMs = 20000,
  fetch: send = globalThis.fetch, resolveHost = resolvePublicHost, allowedHosts,
} = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 4 * 1024 * 1024)
    throw new TypeError("Choose a public-resource limit of 1–4194304 bytes.");
  const timeout = AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  const combined = AbortSignal.any([controller.signal, timeout, ...(signal ? [signal] : [])]);
  let url = publicHttpsUrl(input);
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      combined.throwIfAborted();
      if (allowedHosts && !allowedHosts.includes(url.hostname))
        throw new HttpError(502, "The web provider redirected to an unexpected website.");
      const addresses = await resolveHost(url.hostname, { fetch: send, signal: combined });
      if (!Array.isArray(addresses) || !addresses.length || addresses.some(address => !isPublicAddress(address)))
        throw new HttpError(400, "This address is not a public website.");
      const response = await send(url.href, { method: "GET", redirect: "manual", credentials: "omit",
        headers: { Accept: "*/*" }, signal: combined });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location");
        await response.body?.cancel();
        if (!location || redirects === 3) throw new HttpError(502, "The website redirected too many times.");
        url = publicHttpsUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new HttpError(response.status === 429 ? 429 : 502,
          response.status === 429 ? "The website is busy. Try again later." : "The public resource could not be read.");
      }
      return { url: url.href, contentType: (response.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase(),
        bytes: await boundedBytes(response, maxBytes, combined) };
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (timeout.aborted) throw new HttpError(504, "Reading the website timed out.");
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "The public resource could not be read.");
  } finally {
    controller.abort();
  }
}
