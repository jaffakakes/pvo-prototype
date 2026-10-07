// Fixed provider capability probe only. Never accepts generated source or account credentials.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, copyFile, writeFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";
import { execFileSync, spawn } from "node:child_process";

const root = "/sandbox-proof";
const release = "20260928.0";
const digest =
  "4ce35ca83aef7f96b06cde668e0b23aa98b05aa1829508e974196c2a1e02786c95f5bf79315fd7ddcfd88fe7a00f083ed8053e25eff7673d28d5256440caae8b";
await mkdir(root, { recursive: false });
const startedAt = Date.now();
const status = async (phase, details = {}) => {
  await writeFile(
    "/runtime/sandbox-status.next",
    JSON.stringify({
      phase,
      elapsedMs: Date.now() - startedAt,
      rss: process.memoryUsage().rss,
      ...details,
    }),
  );
  await rename("/runtime/sandbox-status.next", "/runtime/sandbox-status.json");
};
await status("downloading");
const response = await fetch(
  `https://storage.googleapis.com/gvisor/releases/release/${release}/x86_64/gvisor.tar.zstd`,
  { redirect: "error", signal: AbortSignal.timeout(45000) },
);
assert.equal(response.ok, true, "Sandbox archive download failed");
const hash = createHash("sha512");
let bytes = 0;
await pipeline(
  Readable.fromWeb(response.body),
  new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > 200 * 1024 * 1024)
        return done(new Error("Sandbox archive exceeded its byte limit"));
      hash.update(chunk);
      done(null, chunk);
    },
  }),
  createWriteStream(`${root}/archive`, { flags: "wx", mode: 0o600 }),
);
assert.equal(hash.digest("hex"), digest, "Sandbox archive digest mismatch");
await status("expanding", { bytes });
let expanded = 0;
let nextProgress = 32 * 1024 * 1024;
const unpack = spawn(
  "tar",
  ["-xf", "-", "-C", root, "--exclude=containerd-shim-runsc-v1"],
  { stdio: ["pipe", "ignore", "pipe"] },
);
let unpackError = "";
unpack.stderr.on("data", (part) => {
  unpackError = (unpackError + part.toString()).slice(0, 4096);
});
const unpacked = new Promise((resolve, reject) => {
  unpack.once("error", reject);
  unpack.once("exit", (code) =>
    code === 0
      ? resolve()
      : reject(new Error("Sandbox extraction failed: " + unpackError)),
  );
});
const unpackDeadline = setTimeout(() => unpack.kill("SIGKILL"), 45000);
try {
  await Promise.all([
    unpacked,
    pipeline(
      createReadStream(`${root}/archive`),
      createZstdDecompress(),
      new Transform({
        transform(chunk, _encoding, done) {
          expanded += chunk.length;
          if (expanded > 1024 * 1024 * 1024)
            return done(new Error("Expanded archive too large"));
          if (expanded >= nextProgress) {
            nextProgress += 32 * 1024 * 1024;
            void status("expanding", { expanded }).then(
              () => done(null, chunk),
              done,
            );
          } else done(null, chunk);
        },
      }),
      unpack.stdin,
    ),
  ]);
} finally {
  clearTimeout(unpackDeadline);
  unpack.kill("SIGKILL");
}
await rm(`${root}/archive`);
const installedMs = Date.now() - startedAt;
await status("copying-base", { installedMs });
const rootfs = `${root}/rootfs`;
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
for (const path of ["proc", "dev", "tmp"])
  await mkdir(`${rootfs}/${path}`, { recursive: true });
const program = String.raw`
import net from 'node:net';
import dgram from 'node:dgram';
import {existsSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const tcp=(host)=>new Promise(resolve=>{const s=net.connect({host,port:443});const done=v=>{s.destroy();resolve(v);};s.once('connect',()=>done(true));s.once('error',()=>done(false));s.setTimeout(1000,()=>done(false));});
const udp=(host,type)=>new Promise(resolve=>{const s=dgram.createSocket(type);let finished=false;const done=v=>{if(finished)return;finished=true;clearTimeout(timer);s.close();resolve(v);};const timer=setTimeout(()=>done(false),1000);s.once('message',()=>done(true));s.once('error',()=>done(false));s.send(Buffer.from('727301000001000000000000076578616d706c6503636f6d0000010001','hex'),53,host,e=>{if(e)done(false)});});
const network=await Promise.all([tcp('1.1.1.1'),tcp('2606:4700:4700::1111'),udp('1.1.1.1','udp4'),udp('2606:4700:4700::1111','udp6')]);
const child=spawnSync(process.execPath,['-e','process.stdout.write(String(process.getuid()))'],{encoding:'utf8',timeout:1000});
let gainedRoot=false;try{process.setuid(0);gainedRoot=process.getuid()===0}catch{}
process.stdout.write(JSON.stringify({nodeVersion:process.versions.node,uid:process.getuid(),childUid:child.stdout,network,gainedRoot,hostFiles:['/runtime','/sandbox-proof','/.fly','/proc/1/root/runtime'].filter(existsSync),status:readFileSync('/proc/self/status','utf8').split('\n').filter(x=>/^(Cap|NoNewPrivs)/.test(x))}));
`;
await writeFile(
  `${root}/config.json`,
  JSON.stringify({
    ociVersion: "1.0.2",
    root: { path: rootfs, readonly: true },
    process: {
      terminal: false,
      user: { uid: 1000, gid: 1000 },
      args: ["/usr/local/bin/node", "--input-type=module", "-e", program],
      env: ["PATH=/usr/local/bin", "HOME=/tmp"],
      cwd: "/tmp",
      noNewPrivileges: true,
      capabilities: {
        bounding: [],
        effective: [],
        inheritable: [],
        permitted: [],
        ambient: [],
      },
      rlimits: [{ type: "RLIMIT_NOFILE", hard: 256, soft: 256 }],
    },
    mounts: [
      { destination: "/proc", type: "proc", source: "proc" },
      { destination: "/dev", type: "tmpfs", source: "tmpfs" },
      {
        destination: "/tmp",
        type: "tmpfs",
        source: "tmpfs",
        options: ["nosuid", "nodev", "noexec", "mode=1777", "size=16777216"],
      },
    ],
    linux: {
      namespaces: ["pid", "network", "ipc", "uts", "mount"].map((type) => ({
        type,
      })),
    },
  }),
);
const flags = [
  `--root=${root}/control`,
  "--network=none",
  "--platform=systrap",
  "--directfs=false",
  "--host-uds=none",
  "--host-fifo=none",
  "--ignore-cgroups=true",
  "--overlay2=none",
];
await status("executing", { installedMs });
try {
  const result = execFileSync(
    `${root}/runsc`,
    [...flags, "run", "--bundle", root, "probe"],
    { encoding: "utf8", timeout: 12000, maxBuffer: 64 * 1024 },
  );
  await status("passed", {
    result: { installedMs, archiveBytes: bytes, actual: JSON.parse(result) },
  });
} finally {
  execFileSync(`${root}/runsc`, [...flags, "delete", "--force", "probe"], {
    timeout: 5000,
    maxBuffer: 4096,
  });
}
