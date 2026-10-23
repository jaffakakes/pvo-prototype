/** Transport errors are mapped to feature-specific HTTP messages by callers. */
export class ExactUploadError extends Error {
  constructor(code) {
    super(`Exact upload failed: ${code}`);
    this.code = code;
  }
}

async function pumpBody(body, fixed, signal) {
  const reader = body.getReader();
  const writer = fixed.writable.getWriter();
  let cancelling;
  const cancel = () => {
    cancelling ??= Promise.allSettled([
      reader.cancel(signal.reason),
      writer.abort(signal.reason),
    ]);
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      await writer.write(value);
    }
    await writer.close();
  } catch (error) {
    cancelling ??= Promise.allSettled([
      reader.cancel(error),
      writer.abort(error),
    ]);
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (cancelling) await cancelling;
    reader.releaseLock();
    writer.releaseLock();
  }
}

/** Stream a single exact-length conditional write; settle both owners before returning. */
export async function putExactBody(
  request,
  bucket,
  key,
  bytes,
  { timeoutMs = 15 * 60 * 1000, httpMetadata } = {},
) {
  if (!request.body) throw new ExactUploadError("missing");
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) !== bytes)
    throw new ExactUploadError("length");
  const fixed = new FixedLengthStream(bytes);
  const abort = new AbortController();
  const cancel = () => abort.abort(request.signal?.reason);
  request.signal?.addEventListener("abort", cancel, { once: true });
  if (request.signal?.aborted) cancel();
  const timer = setTimeout(cancel, timeoutMs);
  let pumping, storing;
  try {
    abort.signal.throwIfAborted();
    pumping = pumpBody(request.body, fixed, abort.signal);
    storing = Promise.resolve(
      bucket.put(key, fixed.readable, {
        onlyIf: { etagDoesNotMatch: "*" },
        ...(httpMetadata ? { httpMetadata } : {}),
      }),
    ).then((stored) => {
      if (!stored) throw new ExactUploadError("conditional");
      if (stored.size !== bytes) throw new ExactUploadError("incomplete");
      return stored;
    });
    const [, stored] = await Promise.all([pumping, storing]);
    return stored;
  } catch (error) {
    abort.abort();
    // A failed conditional put may never consume the readable side.
    await fixed.readable.cancel().catch(() => {});
    await Promise.allSettled([pumping, storing]);
    if (error instanceof ExactUploadError) throw error;
    throw new ExactUploadError("interrupted");
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", cancel);
  }
}
