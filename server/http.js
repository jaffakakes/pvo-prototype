export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function notFound() {
  return new Response("This video or page is unavailable.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function checkOrigin(request, origin) {
  if (request.headers.get("Origin") !== origin)
    throw new HttpError(403, "This operation must start from the editor.");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none")
    throw new HttpError(403, "This operation must start from the editor.");
}

export async function readJson(request, limit = 8192) {
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim() !== "application/json")
    throw new HttpError(415, "Send application/json.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A request body is required.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, "The request is too large.");
      }
      chunks.push(value);
    }
    const data = new Uint8Array(size);
    let cursor = 0;
    for (const chunk of chunks) { data.set(chunk, cursor); cursor += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(data));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "The request must contain valid JSON.");
  } finally {
    reader.releaseLock();
  }
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
