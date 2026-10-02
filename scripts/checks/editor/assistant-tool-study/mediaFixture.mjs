import { readFile } from "node:fs/promises";

/** Serve the local fixture as seekable media, including the browser's byte-range requests. */
export function fixtureMediaResponse(bytes, range) {
  const headers = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" };
  if (!range) return { status: 200, headers: { ...headers, "Content-Length": String(bytes.length) }, body: bytes };
  const unsatisfied = () => ({ status: 416,
    headers: { ...headers, "Content-Range": `bytes */${bytes.length}`, "Content-Length": "0" }, body: Buffer.alloc(0) });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return unsatisfied();
  const first = Number(match[1]), last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return unsatisfied();
  const start = match[1] ? first : Math.max(0, bytes.length - last);
  const end = match[1] && match[2] ? Math.min(last, bytes.length - 1) : bytes.length - 1;
  if (start >= bytes.length || end < start) return unsatisfied();
  const body = bytes.subarray(start, end + 1);
  return { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
    "Content-Length": String(body.length) }, body };
}

export async function loadStudyMedia(page, mediaPath) {
  const bytes = await readFile(mediaPath);
  await page.route("**/__study_media.mp4", route => route.fulfill(fixtureMediaResponse(bytes, route.request().headers().range)));
  return page.evaluate(async () => {
    // A stable test-only URL prevents random blob IDs changing paired model context hashes.
    const url = new URL("/__study_media.mp4", location.href).href;
    const video = document.createElement("video");
    video.preload = "metadata";
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Study media metadata timed out")), 15000);
        video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
        video.onerror = () => { clearTimeout(timer); reject(new Error("Study media could not be decoded")); };
        video.src = url;
      });
      return { url, duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    } finally { video.removeAttribute("src"); video.load(); }
  });
}
