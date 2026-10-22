import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import {
  taskFixture,
  hosted,
  control,
  expectStatus,
} from "../../../tests/service-actions/helpers.mjs";
import { ORIGIN } from "../../../tests/assistant-task-server/helpers.mjs";
import { comparisonSandbox } from "../model-comparison/sandbox.mjs";
import { digest } from "../model-comparison/workspace.mjs";
import { isolatedTaskEffects } from "./effects.mjs";
import { controlledEmail } from "./durable-email.mjs";
import { pressureJourney } from "./pressure-journeys.mjs";
import { checkPressureViewer } from "./pressure-viewer.mjs";

const inputPath = process.argv[2];
const original = JSON.parse(await readFile(inputPath, "utf8"));
const scenario = pressureJourney(original.scenario);
assert.ok(scenario);
const identity = original.preparedResult.attachment.receipt.identity;
const checked = original["validation-state"].artifacts.find(
  (item) => item.artifact.identity.packageDigest === identity.packageDigest,
);
assert.equal(checked?.report.status, "passed");
assert.equal(original.resultSurvivedRestart, true);
const bytes = await readFile(join(dirname(inputPath), "generated.pvo"));
const directory = join(
  homedir(),
  ".codex/secure/restyle-capability",
  `pressure-replay-${Date.now()}`,
);
await mkdir(directory, { recursive: true, mode: 0o700 });
const report = {
  measurementKind: "preserved-artifact-replay",
  freshModelRequests: 0,
  originalJournal: inputPath,
  originalSource: original.source,
  source: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  scenario: original.scenario,
  originalVideoDigest: digest(bytes),
  artifactIdentity: checked.artifact.identity,
  transportScope:
    "The unchanged old export targets its original service ID. The controlled test transport maps only that exact ID to a fresh local service with identical checked package/agreement. This does not test old-release permission equivalence.",
  resources: [
    { kind: "local-worker", name: "preserved-artifact-host", cleaned: false },
    { kind: "browser", name: "preserved-artifact-viewer", cleaned: false },
  ],
  browserChecks: [],
  status: "running",
  startedAt: new Date().toISOString(),
};
let pending = Promise.resolve();
const save = () => {
  const body = JSON.stringify(report, null, 2);
  pending = pending.then(async () => {
    await writeFile(join(directory, "report.tmp"), body, { mode: 0o600 });
    await rename(join(directory, "report.tmp"), join(directory, "report.json"));
  });
  return pending;
};
await save();
console.log(`Journal: ${directory}/report.json`);
const sandbox = await comparisonSandbox(async (resource) => {
  const index = report.resources.findIndex(
    (item) => item.name === resource.name,
  );
  if (index < 0) report.resources.push(structuredClone(resource));
  else report.resources[index] = structuredClone(resource);
  await save();
});
let fixture, browser;
try {
  const email = scenario.connectedEmail ? controlledEmail() : null;
  fixture = await taskFixture({
    services: true,
    ...isolatedTaskEffects(sandbox),
    connectionKey: scenario.connectionKey,
    connectionFetch: email?.connectionFetch,
  });
  report.resources[0].storagePath = fixture.storagePath;
  await save();
  if (email) await email.seed(fixture);
  const service = await hosted(fixture, {
    checked: { artifact: checked.artifact, report: checked.report },
  });
  if (email)
    expectStatus(
      await fixture.request(
        `/api/services/${service.identity.serviceId}/account-access`,
        { body: { kind: "approve", releaseId: service.identity.resourceId } },
      ),
      200,
    );
  expectStatus(await control(fixture, service, "activate"), 200);
  report.localServiceIdentity = service.identity;
  await save();
  browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const oldPrefix = `/api/services/${identity.serviceId}/`;
  const mapped = {
    request: (path, options) => {
      assert.ok(
        path.startsWith(oldPrefix),
        "Only the preserved export's exact service may be mapped.",
      );
      return fixture.request(
        `/api/services/${service.identity.serviceId}/` +
          path.slice(oldPrefix.length),
        options,
      );
    },
    restart: () => fixture.restart(),
  };
  await checkPressureViewer(
    { browser, origin: ORIGIN },
    mapped,
    bytes,
    directory,
    async (kind, data) => {
      report.browserChecks.push({ kind, ...data });
      await save();
    },
    email,
    scenario,
  );
  assert.equal(
    digest(await readFile(join(dirname(inputPath), "generated.pvo"))),
    report.originalVideoDigest,
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close();
    report.resources[1].cleaned = true;
  }
  if (fixture) {
    await fixture.close();
    report.resources[0].cleaned = true;
  }
  report.completedAt = new Date().toISOString();
  report.cleanupVerified = report.resources.every(
    (resource) => resource.cleaned,
  );
  await save();
  console.log(
    `Complete: ${report.status}; zero new model requests; cleanup=${report.cleanupVerified}`,
  );
}
