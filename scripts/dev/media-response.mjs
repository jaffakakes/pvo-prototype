import { createReadStream } from "node:fs";
import { byteRange } from "../../server/viewing/range.js";

/** Node response effects around the same byte-range policy as hosted viewing. */
export function sendMediaFile(request, response, file, { size, type, video }) {
  let range;
  try {
    range = video ? byteRange(request.headers.range, size) : null;
  } catch (error) {
    response.writeHead(error.status, { "Content-Range": `bytes */${size}` });
    response.end();
    return;
  }
  response.writeHead(range ? 206 : 200, {
    "Content-Type": type,
    "Content-Length": range ? range.length : size,
    ...(range
      ? {
          "Content-Range": `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`,
        }
      : {}),
    ...(video ? { "Accept-Ranges": "bytes" } : {}),
    "Cache-Control": "no-store",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(
    file,
    range
      ? {
          start: range.offset,
          end: range.offset + range.length - 1,
        }
      : {},
  );
  stream.on("error", (error) => response.destroy(error));
  response.once("close", () => stream.destroy());
  stream.pipe(response);
}
