import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, win32, posix } from "node:path";
import { chromium } from "playwright-core";

export function resolveBrowserExecutable({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  if (env.CHROME_PATH) {
    const override = env.CHROME_PATH;
    const candidates = /[\\/]/.test(override)
      ? [override]
      : (env.PATH ?? env.Path ?? "")
          .split(platform === "win32" ? ";" : ":")
          .flatMap((directory) => [
            (platform === "win32" ? win32 : posix).join(directory, override),
            ...(platform === "win32" && !/\.exe$/i.test(override)
              ? [win32.join(directory, override + ".exe")]
              : []),
          ]);
    const executable = candidates.find(exists);
    if (!executable)
      throw new Error(
        "CHROME_PATH does not point to an installed Chrome/Chromium executable.",
      );
    return executable;
  }
  const candidates =
    platform === "win32"
      ? [
          join(
            env.PROGRAMFILES || "C:/Program Files",
            "Google/Chrome/Application/chrome.exe",
          ),
          join(
            env["ProgramFiles(x86)"] || "C:/Program Files (x86)",
            "Google/Chrome/Application/chrome.exe",
          ),
          ...(env.LOCALAPPDATA
            ? [join(env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe")]
            : []),
        ]
      : platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ];
  const executable = candidates.find(exists);
  if (!executable)
    throw new Error(
      "Browser checks need Chrome or Chromium. Install one, or set CHROME_PATH to its executable.",
    );
  return executable;
}

export function launchBrowser(options = {}) {
  return chromium.launch({
    headless: true,
    ...options,
    executablePath: resolveBrowserExecutable(),
  });
}

/** Fresh storage plus one owned static fixture server; close both on every path. */
export async function createBrowserFixture(
  assets,
  { launchOptions, contextOptions } = {},
) {
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://fixture").pathname;
    const asset = assets.get(path);
    if (!asset) {
      response.writeHead(path === "/favicon.ico" ? 204 : 404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": asset.type,
      "Cache-Control": "no-store",
    });
    response.end(asset.body);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let browser, closing;
  const close = () =>
    (closing ??= (async () => {
      try {
        await browser?.close();
      } finally {
        await new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        });
      }
    })());
  try {
    browser = await launchBrowser(launchOptions);
    const context = await browser.newContext(contextOptions);
    return {
      browser,
      context,
      origin: `http://127.0.0.1:${server.address().port}`,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
