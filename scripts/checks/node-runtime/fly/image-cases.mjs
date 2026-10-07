import assert from "node:assert/strict";
import { FlyProofMachine } from "./machine.mjs";
import { inspectRuntimeStartup } from "./startup.mjs";
import { networkProbeProgram } from "./network.mjs";
import { IMAGE_PROOF, runtimeConfiguration } from "./image.mjs";
import { exerciseNode } from "../exercise.mjs";
import { parseNodeBundle } from "../../../../packages/pvo-assistant/services/index.js";

export async function runImageCases(resources) {
  const { report, save } = resources;
  async function withRuntime(
    label,
    source,
    { dependencies = [], failure = null, extraFiles = [] } = {},
  ) {
    const row = { label, startedAt: Date.now(), status: "pending" };
    report.checks.push(row);
    await save();
    console.log(`Checking ${label}`);
    const record = await resources.createMachine([], (options) =>
      runtimeConfiguration(report.build.image, options),
    );
    const machine = new FlyProofMachine(resources, record, {
      image: report.build.image,
      bridgePath: "/runtime/transport.mjs",
      executionMs: IMAGE_PROOF.transportDeadlineMs,
    });
    try {
      const startup = Date.now();
      await machine.start();
      row.startupMs = Date.now() - startup;
      const bundle = parseNodeBundle({
        entrypoint: "src/main.mjs",
        files: [{ path: "src/main.mjs", content: source }, ...extraFiles],
        dependencies,
      });
      let value;
      try {
        value = await machine.execute(bundle, {
          operation: "probe",
          input: {},
          state: { retained: "outside guest" },
          now: 0,
        });
        assert.equal(failure, null, "Expected execution failure did not occur");
      } catch (error) {
        if (!failure) throw error;
        assert.equal(error.code, failure);
        value = null;
      }
      row.status = "passed";
      return value;
    } catch (error) {
      row.status = "failed";
      row.inspection = await inspectRuntimeStartup(machine);
      throw error;
    } finally {
      await machine.destroy();
      row.durationMs = Date.now() - row.startedAt;
      await save();
    }
  }
  await exerciseNode(withRuntime);
  const boundary = await withRuntime(
    "Packaged network, identity and host-file boundary",
    networkProbeProgram +
      `
import {existsSync,readFileSync} from 'node:fs';
export function execute({state}){return {result:{network,uid:process.getuid(),hostFiles:['/control','/sandbox','/.fly','/build','/run/restyle-registry-token','/runtime/supervisor.mjs','/proc/1/root/control'].filter(existsSync),status:readFileSync('/proc/self/status','utf8').split('\\n').filter(line=>/^(Cap|NoNewPrivs)/.test(line))},state};}`,
  );
  assert.deepEqual(boundary.result.network, {
    tcp4: false,
    tcp6: false,
    udp4: false,
    udp6: false,
  });
  assert.equal(boundary.result.uid, 1000);
  assert.deepEqual(boundary.result.hostFiles, []);
  assert.equal(
    boundary.result.status.filter((line) => /^Cap\w+:\s+0+$/.test(line)).length,
    5,
  );
  assert.ok(
    boundary.result.status.some((line) => /^NoNewPrivs:\s+1$/.test(line)),
  );
  const bounded = await withRuntime(
    "Large accepted source delivery",
    `export function execute({state}){return {result:'delivered',state};}`,
    {
      extraFiles: Array.from({ length: 9 }, (_, index) => ({
        path: `src/filler${index}.mjs`,
        content: "//" + "x".repeat(100000),
      })),
    },
  );
  assert.equal(bounded.result, "delivered");
}
