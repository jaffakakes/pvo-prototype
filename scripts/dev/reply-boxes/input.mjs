import { HttpError } from "../../../server/http.js";

const MAX_BODY_BYTES = 8 * 1024;

export async function readReplyJson(request) {
  if (
    request.headers["content-type"]?.split(";", 1)[0].trim() !==
    "application/json"
  )
    throw new HttpError(415, "Send application/json.");
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    throw new HttpError(413, "This request is too large.");
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES)
      throw new HttpError(413, "This request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Send valid JSON.");
  }
}
