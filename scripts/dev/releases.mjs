import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

/** Local beta counterpart to the Cloudflare release channel. */
export function attachReleaseNotifications(server, outputRoot) {
  const sockets = new WebSocketServer({ noServer: true });
  const releasePath = join(outputRoot, "editor/release.json");
  let latest = null;
  let debounce;
  async function readRelease() {
    const release = JSON.parse(await readFile(releasePath, "utf8"));
    if (!/^restyle-editor-shell-[a-f0-9]{16}$/.test(release.revision)) throw new Error("Invalid beta release revision");
    return release.revision;
  }
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== "/api/releases/connect" || request.headers.origin !== url.origin) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, client => {
      client.on("error", error => console.warn("Beta release connection failed:", error.message));
      client.on("message", () => client.close(1008, "Release notifications are read-only"));
      void readRelease().then(revision => {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "release", revision }));
      }).catch(error => console.warn("Could not read beta release:", error.message));
    });
  });
  const watcher = watch(join(outputRoot, "editor"), (_event, filename) => {
    if (filename?.toString() !== "release.json") return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      void readRelease().then(revision => {
        if (revision === latest) return;
        latest = revision;
        for (const client of sockets.clients) {
          if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "release", revision }));
        }
      }).catch(error => console.warn("Could not announce beta release:", error.message));
    }, 100);
  });
  watcher.on("error", error => console.warn("Beta release watcher failed:", error.message));
  return () => {
    clearTimeout(debounce);
    watcher.close();
    for (const client of sockets.clients) client.terminate();
    sockets.close();
  };
}
