import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "vite";
import { resolveBrowserExecutable } from "./helpers/browser.mjs";

// Own a separate origin and browser contexts, never the developer's app storage.
resolveBrowserExecutable();
const http = createHttpServer();
const server = await createServer({
  configFile: fileURLToPath(
    new URL("../../editor/vite.config.ts", import.meta.url),
  ),
  server: { middlewareMode: true, hmr: { server: http } },
});
http.on("request", server.middlewares);
try {
  await new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", resolve);
  });
  const editorUrl = `http://127.0.0.1:${http.address().port}/`;
  console.log(`Isolated browser smoke server: ${editorUrl}`);
  const groups =
    process.argv.length > 2
      ? [process.argv.slice(2)]
      : [
          [
            "editor",
            "project-saving-concurrency",
            "project-header",
            "selection-dismissal",
            "tool-trays",
            "no-code-workspace",
            "timeline-keyframes",
            "task-project-link",
          ],
          ["player", "project-switching"],
          ["runtime", "form-values", "isolation"],
        ];
  for (const group of groups) {
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("./run.mjs", import.meta.url)), ...group],
        {
          stdio: "inherit",
          env: { ...process.env, EDITOR_URL: editorUrl },
        },
      );
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        code === 0
          ? resolve()
          : reject(new Error(`Browser smoke failed (${signal || code}).`)),
      );
    });
  }
} finally {
  await server.close();
  await new Promise((resolve) => {
    http.close(resolve);
    http.closeAllConnections();
  });
}
