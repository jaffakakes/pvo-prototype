import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { attachReleaseNotifications } from "./releases.mjs";
import { createLocalSessions, localBetaDataDirectory } from "./local-sessions.mjs";
import { createLocalRenderApi } from "./render-jobs.mjs";
import { createLocalReplyBoxApi } from "./reply-boxes.mjs";
import { createLocalAuthApi } from "./local-auth.mjs";

const root = fileURLToPath(new URL("../../dist/", import.meta.url));
const port = Number(process.env.PVO_PORT || 4173);
const localDataDirectory = process.env.PVO_LOCAL_DATA_DIR || localBetaDataDirectory;
const sessions = await createLocalSessions({ directory: localDataDirectory });
const authApi = await createLocalAuthApi({ directory: localDataDirectory,
  origin: `http://127.0.0.1:${port}`, clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  clerkIssuer: process.env.CLERK_ISSUER });
const renderApi = await createLocalRenderApi({ userFor: authApi.userFor });
const replyApi = await createLocalReplyBoxApi({ sessions, directory: localDataDirectory });
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".pvo": "application/vnd.pvo",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

const server = createServer(async (request, response) => {
  let url;
  let pathname;
  try {
    url = new URL(request.url, `http://${request.headers.host}`);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Invalid request address");
    return;
  }
  if (pathname.startsWith("/api/auth/") || pathname.startsWith("/api/renders") || pathname.startsWith("/api/reply-boxes")) {
    try {
      if (pathname.startsWith("/api/auth/")) await authApi.handle(request, response, pathname);
      else if (pathname.startsWith("/api/reply-boxes")) await replyApi.handle(request, response, pathname, url.origin);
      else await renderApi.handle(request, response, pathname, url.origin);
    } catch (error) {
      console.error("Local API request failed:", error?.name);
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ error: "The request could not finish." }));
      } else response.destroy(error);
    }
    return;
  }
  const clean = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  let file = join(root, clean === "/" ? "index.html" : clean);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file) || !file.startsWith(root)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const extension = extname(file).toLowerCase();
  const isVideo = extension === ".mp4" || extension === ".mov";
  const fileSize = statSync(file).size;
  const range = request.headers.range;
  if (range && isVideo) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      response.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), fileSize - 1) : fileSize - 1;
    if (start > end || start >= fileSize) {
      response.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      "Content-Type": mime[extension],
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    createReadStream(file, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, {
    "Content-Type": mime[extension] || "application/octet-stream",
    "Content-Length": fileSize,
    ...(isVideo ? { "Accept-Ranges": "bytes" } : {}),
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(response);
});
const closeReleases = attachReleaseNotifications(server, root);
server.on("close", closeReleases);
server.on("close", () => { void Promise.all([renderApi.close(), replyApi.close()]); });
server.listen(port, "127.0.0.1", () => {
  console.log(`PVO prototype: http://127.0.0.1:${port}`);
});
