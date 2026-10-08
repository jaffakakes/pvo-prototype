import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertBetaDeployment } from "../scripts/build/beta-deployment-config.mjs";

const config = JSON.parse(
  await readFile(new URL("../wrangler.beta.jsonc", import.meta.url), "utf8"),
);
test("the beta deployment admits only the owned beta resource set", () => {
  assert.equal(assertBetaDeployment(config), config);
  for (const mutate of [
    (value) => {
      value.name = "lingering-butterfly-9ba8";
    },
    (value) => {
      value.vars.PUBLIC_ORIGIN = "https://getrestyle.app";
    },
    (value) => {
      value.d1_databases[0].database_id =
        "46ed24c3-1bc3-487a-95cf-7b6b58c1db88";
    },
    (value) => {
      value.r2_buckets[0].bucket_name = "pvo-publications-media";
    },
    (value) => {
      value.routes = ["getrestyle.app/*"];
    },
    (value) => {
      value.durable_objects.bindings[0].script_name =
        "lingering-butterfly-9ba8";
    },
    (value) => {
      value.vars.SERVICE_NODE_FLY_APP = "unrelated-app";
    },
    (value) => {
      value.vars.CLERK_PUBLISHABLE_KEY = "pk_live_wrong-instance";
    },
    (value) => {
      value.containers[0].name = "restyle-agent-workspaces";
    },
    (value) => {
      value.vars.RUNPOD_API_KEY = "private-credential";
    },
    (value) => {
      value.vars.ASSISTANT_TASK_SPENDING = "[]";
    },
    (value) => {
      value.vars.ASSISTANT_DAILY_CAPACITY = "{}";
    },
  ]) {
    const changed = structuredClone(config);
    mutate(changed);
    assert.throws(
      () => assertBetaDeployment(changed),
      /Beta deployment rejected/,
    );
  }
});
