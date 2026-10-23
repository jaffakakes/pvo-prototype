import { supportedNodeLibraries } from "../../../packages/pvo-assistant/services/index.js";
import {
  WORKSPACE_LIMITS as limits,
  workspaceCommandArguments,
} from "../../../packages/pvo-assistant/workspaces/index.js";

const ROOT = "/workspace";
// Only used on a fresh VM, before generated code runs. Stored source is authoritative.
const RESTORE = `
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[1];
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data', part => { input+=part; if (Buffer.byteLength(input)>1179648) process.exit(2); });
process.stdin.on('end', () => {
  function directory(name) {
    try { fs.mkdirSync(name); } catch (error) { if (error.code!=='EEXIST') throw error; }
    const stat=fs.lstatSync(name);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe directory');
  }
  directory(root);
  const {files,libraries}=JSON.parse(input);
  for (const file of files) {
    if (!/^(src|tests)\\/(?:[a-z0-9][a-z0-9_-]*\\/)*[a-z0-9][a-z0-9_.-]*\\.mjs$/.test(file.path) || file.path.includes('..')) throw new Error('unsafe path');
    write(file);
  }
  for (const library of libraries) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(library.name)) throw new Error('unsafe library');
    for (const file of library.files) {
      if (!/^[A-Za-z0-9_.-]+(?:\\/[A-Za-z0-9_.-]+)*$/.test(file.path) || file.path.split('/').some(part=>part==='.'||part==='..')) throw new Error('unsafe library path');
      write({path:'node_modules/'+library.name+'/'+file.path,content:file.content});
    }
  }
  function write(file) {
    const target=path.join(root,file.path);
    let parent=root;
    for (const part of file.path.split('/').slice(0,-1)) { parent=path.join(parent,part); directory(parent); }
    const fd=fs.openSync(target, fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd,file.content); } finally { fs.closeSync(fd); }
  }
});`;

async function collect(process) {
  const readers = [process.stdout.getReader(), process.stderr.getReader()];
  let bytes = 0;
  const read = async (reader) => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > limits.outputBytes)
        throw Object.assign(new Error("Workspace output limit exceeded."), {
          code: "workspace_output_limit",
        });
      text += decoder.decode(value, { stream: true });
    }
  };
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      read(readers[0]),
      read(readers[1]),
      process.exitCode,
    ]);
    if (!Number.isSafeInteger(exitCode))
      throw new Error("Workspace exit status missing.");
    return { stdout, stderr, exitCode };
  } finally {
    // Releasing output readers alone does not terminate descendants; the coordinator destroys the VM on failure.
    for (const reader of readers) void reader.cancel().catch(() => {});
  }
}

/** Native Container effects only. Ownership, deadlines and budgets belong to the coordinator. */
export class WorkspaceContainer {
  constructor(container) {
    this.container = container;
  }
  start(lease) {
    this.container.start({
      image: "cloudflare/debian-trixie",
      instance: "lite",
      entrypoint: ["sleep", String(limits.sessionMs / 1000)],
      enableInternet: false,
      labels: {
        workspace: lease.resourceId.slice("workspace-".length),
        session: String(lease.session),
      },
    });
  }
  async restore(snapshot, assertCurrent) {
    await this.container.setInactivityTimeout(limits.sessionMs);
    assertCurrent();
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        files: snapshot.files,
        libraries: supportedNodeLibraries(),
      }),
    );
    const process = await this.container.exec(["node", "-e", RESTORE, ROOT], {
      stdin: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    });
    const result = await collect(process);
    if (result.exitCode !== 0)
      throw new Error("Workspace source restoration failed.");
  }
  async execute(command) {
    return collect(
      await this.container.exec(workspaceCommandArguments(command), {
        cwd: ROOT,
      }),
    );
  }
  async destroy() {
    await this.container.destroy();
  }
  async absent() {
    return (await this.container.inspect()) === null;
  }
}
