export const SUBJECTS = Object.freeze([
  "recovery",
  "stopped",
  "timeout",
  "output",
]);

export function sourceFiles(subject) {
  const code =
    subject === "timeout"
      ? `import { spawn } from 'node:child_process';
       spawn('node',['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}).unref();
       setInterval(()=>{},1000);`
      : subject === "output"
        ? `process.stdout.write('z'.repeat(32768));`
        : `import assert from 'node:assert/strict';
         import { execute } from '../src/service.mjs';
         assert.equal(execute(),42);
         assert.equal(process.env.PROOF_TOKEN,undefined);
         assert.equal(process.env.CLOUDFLARE_API_TOKEN,undefined);
         let blocked=false;
         try { await fetch('https://example.com',{signal:AbortSignal.timeout(2000)}); }
         catch { blocked=true; }
         assert.equal(blocked,true);
         console.log('workspace fixture verified');`;
  return [
    { path: "src/service.mjs", content: "export const execute = () => 42;\n" },
    { path: "tests/service.test.mjs", content: code },
  ];
}
