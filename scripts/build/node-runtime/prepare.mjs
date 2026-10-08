import {
  mkdir,
  copyFile,
  chmod,
  writeFile,
  readFile,
  rm,
  rename,
} from "node:fs/promises";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { rootCertificates } from "node:tls";
import { downloadVerified } from "./download.mjs";
import { extractSandbox } from "./extract.mjs";

// Runs only in the disposable trusted image builder. No user source enters this process.
const run = promisify(execFile);
const root = "/build";
const layer = `${root}/layer`;
const rootfs = `${layer}/sandbox/rootfs`;
const settings = JSON.parse(
  await readFile("/build-input/settings.json", "utf8"),
);
if (!/^restyle-node-proof-[a-f0-9]{24}$/.test(settings.app))
  throw new Error("Invalid owned build app");
if (!/^node@sha256:[a-f0-9]{64}$/.test(settings.baseImage))
  throw new Error("Invalid immutable Node base");
const registryToken = (
  await readFile("/run/restyle-registry-token", "utf8")
).trim();
const startedAt = Date.now();
const status = async (phase, details = {}) => {
  await writeFile(
    "/runtime/image-status.next",
    JSON.stringify({ phase, elapsedMs: Date.now() - startedAt, ...details }),
  );
  await rename("/runtime/image-status.next", "/runtime/image-status.json");
};
const command = (file, args, options = {}) =>
  run(file, args, {
    timeout: 450000,
    maxBuffer: 64 * 1024,
    killSignal: "SIGKILL",
    ...options,
  });
try {
  await mkdir(root, { recursive: false, mode: 0o700 });
  await mkdir(`${layer}/opt/gvisor`, { recursive: true });
  await status("downloading-sandbox");
  await downloadVerified(
    "https://storage.googleapis.com/gvisor/releases/release/20260928.0/x86_64/gvisor.tar.zstd",
    `${root}/gvisor.tar.zstd`,
    "sha512",
    "4ce35ca83aef7f96b06cde668e0b23aa98b05aa1829508e974196c2a1e02786c95f5bf79315fd7ddcfd88fe7a00f083ed8053e25eff7673d28d5256440caae8b",
    200 * 1024 * 1024,
  );
  await status("unpacking-sandbox");
  await extractSandbox(`${root}/gvisor.tar.zstd`, `${layer}/opt/gvisor`);
  await rm(`${root}/gvisor.tar.zstd`);
  await status("preparing-node");
  for (const path of [
    "/usr/local/bin/node",
    "/lib/x86_64-linux-gnu/libdl.so.2",
    "/lib/x86_64-linux-gnu/libstdc++.so.6",
    "/lib/x86_64-linux-gnu/libm.so.6",
    "/lib/x86_64-linux-gnu/libgcc_s.so.1",
    "/lib/x86_64-linux-gnu/libpthread.so.0",
    "/lib/x86_64-linux-gnu/libc.so.6",
    "/lib64/ld-linux-x86-64.so.2",
  ]) {
    await mkdir(dirname(rootfs + path), { recursive: true });
    await copyFile(path, rootfs + path);
  }
  for (const path of ["proc", "dev", "tmp", "service", "runtime"])
    await mkdir(`${rootfs}/${path}`, { recursive: true });
  const sources = [];
  for (const name of [
    "server.mjs",
    "files.mjs",
    "bridge.mjs",
    "sandbox.mjs",
    "supervisor.mjs",
    "transport.mjs",
  ]) {
    const content = await readFile(`/build-input/${name}`, "utf8");
    sources.push({ path: name, content });
    const destination = ["server.mjs", "files.mjs", "bridge.mjs"].includes(name)
      ? `${rootfs}/runtime/${name}`
      : `${layer}/runtime/${name}`;
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, { mode: 0o644, flag: "wx" });
  }
  const sourceDigest = createHash("sha256")
    .update(JSON.stringify(sources))
    .digest("hex");
  if (sourceDigest !== settings.sourceDigest)
    throw new Error("Runtime source digest mismatch");
  await status("preparing-uploader", { sourceDigest });
  await downloadVerified(
    "https://github.com/google/go-containerregistry/releases/download/v0.22.1/go-containerregistry_Linux_x86_64.tar.gz",
    `${root}/crane.tar.gz`,
    "sha256",
    "0ab7a1d6932a213aed964ce97666c3077fe691c8606413674a8b3e0b9ec4cda0",
    24 * 1024 * 1024,
  );
  await command("tar", ["-xzf", `${root}/crane.tar.gz`, "-C", root, "crane"]);
  await chmod(`${root}/crane`, 0o755);
  await rm(`${root}/crane.tar.gz`);
  await mkdir(`${root}/auth`, { mode: 0o700 });
  const env = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    DOCKER_CONFIG: `${root}/auth`,
    SSL_CERT_FILE: `${root}/ca-certificates.crt`,
  };
  // The pinned Node base has bundled trust roots, but no OS CA package for the Go uploader.
  await writeFile(env.SSL_CERT_FILE, rootCertificates.join("\n"), {
    mode: 0o600,
  });
  // Auth material is outside the layer tree and is removed before this builder is destroyed.
  await writeFile(
    `${root}/auth/config.json`,
    JSON.stringify({
      auths: {
        "registry.fly.io": {
          auth: Buffer.from(`x:${registryToken}`).toString("base64"),
        },
      },
    }),
    { mode: 0o600 },
  );
  await rm("/run/restyle-registry-token");
  await status("packing-image");
  await command("tar", [
    "--sort=name",
    "--mtime=@0",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "-cf",
    `${root}/layer.tar`,
    "-C",
    layer,
    ".",
  ]);
  const reference = `registry.fly.io/${settings.app}:runtime`;
  await status("pushing-image");
  await command(
    `${root}/crane`,
    [
      "append",
      "--platform=linux/amd64",
      "--base",
      settings.baseImage,
      "--new_layer",
      `${root}/layer.tar`,
      "--new_tag",
      reference,
    ],
    { env },
  );
  const { stdout } = await command(
    `${root}/crane`,
    ["digest", "--platform=linux/amd64", reference],
    { env },
  );
  const digest = stdout.trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(digest))
    throw new Error("Registry did not return an immutable image digest");
  await status("passed", {
    image: `registry.fly.io/${settings.app}@${digest}`,
    sourceDigest,
  });
} catch (error) {
  await status("failed", {
    message: String(error.message)
      .replaceAll(registryToken, "[redacted]")
      .slice(0, 1000),
  });
  process.exitCode = 1;
} finally {
  await rm("/run/restyle-registry-token", { force: true });
  await rm(`${root}/auth`, { recursive: true, force: true });
}
