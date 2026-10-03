import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const script = resolve(root, "scripts/dev/send-test-imessage.applescript");
const config = JSON.parse(await readFile(resolve(root, "wrangler.jsonc"), "utf8"));
const origin = new URL(config.vars.PUBLIC_ORIGIN);
const token = (await readFile(resolve(root, ".wrangler/imessage-bridge-token"), "utf8")).trim();
if (origin.protocol !== "https:" || token.length < 32) throw new Error("The Mac sender is not configured.");

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));

async function bridgeRequest(path, options = {}) {
  const response = await fetch(new URL(path, origin), {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) },
    redirect: "error",
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`Mac sender endpoint returned HTTP ${response.status}.`);
  return response.json();
}

async function messages(scriptArguments) {
  const { stdout } = await execute("/usr/bin/osascript", [script, ...scriptArguments], { timeout: 60_000, maxBuffer: 2048 });
  return stdout.trim();
}

// Do not advertise the bridge as online until macOS permits Messages automation.
let accountReady = false;
try {
  accountReady = await messages(["--check"]) === "ready";
} catch {
  console.error("Messages did not answer. Approve the macOS Automation prompt for Messages and start the sender again.");
  process.exit(1);
}
if (!accountReady) throw new Error("Messages has no enabled iMessage account.");
console.log("Mac iMessage test sender ready. Stop with Ctrl+C.");

while (!controller.signal.aborted) {
  try {
    const next = await bridgeRequest("/api/imessage/next");
    if (next?.job) {
      const { id, phone, text } = next.job;
      if (!/^[0-9a-f-]{36}$/.test(id) || !/^\+[1-9]\d{7,14}$/.test(phone) || text !== "Hi, how are you?")
        throw new Error("The Mac sender received an invalid job.");
      let sent = false;
      try {
        sent = await messages([phone]) === "sent";
      } catch {
        console.error("Messages could not send this test message. Check its account and Automation permission.");
      }
      try {
        await bridgeRequest("/api/imessage/result", { method: "POST", body: JSON.stringify({ id, sent }) });
      } catch {
        console.error("Could not report the result. This message will not be sent again automatically.");
      }
      console.log(sent ? "Messages accepted one test message." : "One test message failed.");
    }
  } catch (error) {
    if (controller.signal.aborted) break;
    console.error(error instanceof Error ? error.message : "The Mac sender could not reach the website.");
  }
  if (!controller.signal.aborted) await pause(1500);
}
