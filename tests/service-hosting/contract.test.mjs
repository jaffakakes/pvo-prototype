import assert from "node:assert/strict";
import test from "node:test";
import { create } from "../assistant-tasks/fixtures.mjs";
import { checkedFixture } from "./fixtures.mjs";
import {
  prepareServicePublication,
  verifyServicePublication,
} from "../../server/cloud-services/releaseContract.js";
import {
  parseServicePublication,
  parseCheckedService,
} from "../../packages/pvo-assistant/releases/index.js";

test("an owned release binds canonical source, agreement, package and complete report while retaining its stable service identity", async () => {
  const checked = await checkedFixture(),
    task = create();
  const first = await prepareServicePublication(task, "release-1", checked);
  assert.deepEqual(
    await prepareServicePublication(task, "release-1", checked),
    first,
  );
  assert.deepEqual(await verifyServicePublication(first), first);
  const changed = await prepareServicePublication(
    task,
    "release-1",
    await checkedFixture(
      "export function execute(){return {result:null,state:null};}",
    ),
  );
  assert.equal(changed.identity.resourceId, first.identity.resourceId);
  assert.equal(changed.identity.serviceId, first.identity.serviceId);
  assert.notEqual(changed.identity.packageDigest, first.identity.packageDigest);
  assert.notEqual(changed.identity.reportDigest, first.identity.reportDigest);
  const next = await prepareServicePublication(task, "release-2", checked);
  assert.equal(next.identity.serviceId, first.identity.serviceId);
  assert.notEqual(next.identity.resourceId, first.identity.resourceId);
  for (const foreign of [
    { ...task, ownerId: "other" },
    { ...task, input: { ...task.input, projectId: "other" } },
    { ...task, id: "other-task" },
  ]) {
    const result = await prepareServicePublication(
      foreign,
      "release-1",
      checked,
    );
    assert.notEqual(result.identity.serviceId, first.identity.serviceId);
    assert.notEqual(result.identity.resourceId, first.identity.resourceId);
  }
});

test("publication rejects partial or forged shape reports, superseded source strings and stale canonical bytes", async () => {
  const checked = await checkedFixture();
  const published = await prepareServicePublication(
    create(),
    "release-1",
    checked,
  );
  assert.throws(() =>
    parseServicePublication({
      identity: published.identity,
      source: "export default {};",
    }),
  );
  assert.throws(() =>
    parseCheckedService({
      ...checked,
      report: { ...checked.report, status: "running", cases: [] },
    }),
  );
  for (const change of [
    (value) => {
      value.artifact.package.files[0].content += "\n// changed";
    },
    (value) => {
      value.artifact.agreement.description += " changed";
    },
    (value) => {
      value.identity.reportDigest = "0".repeat(64);
    },
    (value) => {
      value.identity.ownerId = "other-owner";
    },
    (value) => {
      value.identity.serviceId = "other-service";
    },
    (value) => {
      value.report.passed = true;
    },
    (value) => {
      value.artifact.package.dependencies.push({ name: "external-package" });
    },
    (value) => {
      value.artifact.package.files[0].content = "é".repeat(131073);
    },
  ]) {
    const value = structuredClone(published);
    change(value);
    await assert.rejects(verifyServicePublication(value));
  }
});
