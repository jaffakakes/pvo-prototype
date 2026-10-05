import { limits, readBounded } from "./proof-http.js";

// Destroying the VM also stops descendants. Killing only exec's direct process does not.
export async function executeBounded(
  container,
  argv,
  timeoutMs = limits.commandMs,
) {
  let timer;
  let expired = false;
  let stopping;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      stopping = container.destroy().catch(() => {});
      reject(new Error("command_timeout"));
    }, timeoutMs);
  });
  const execute = async () => {
    const process = await container.exec(argv);
    const [stdout, stderr, exitCode] = await Promise.all([
      readBounded(process.stdout, limits.artifactBytes),
      readBounded(process.stderr, limits.responseBytes),
      process.exitCode,
    ]);
    return { stdout, stderr, exitCode };
  };
  try {
    return await Promise.race([execute(), deadline]);
  } finally {
    clearTimeout(timer);
    if (expired) await stopping;
  }
}
