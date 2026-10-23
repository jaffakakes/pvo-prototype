import assert from "node:assert/strict";
import test from "node:test";
import {
  taskFixture,
  hosted,
  control,
  expectStatus,
  inspect,
} from "../service-actions/helpers.mjs";
import { dinnerAgreement } from "../service-validation/fixtures.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { NOW } from "../assistant-task-server/helpers.mjs";
const key = "e".repeat(64);
function agreement() {
  const value = dinnerAgreement();
  value.operations[0].delivery = "background";
  return value;
}
const path = (service) => `/api/services/${service.identity.serviceId}`;
const submit = (f, service, actionId = "accepted", schedule = null) =>
  f.request(path(service) + "/jobs", {
    session: null,
    body: {
      releaseId: service.identity.resourceId,
      action: { actionId, operation: "join", input: { name: "Guest" } },
      receiptKey: key,
      schedule,
    },
  });
const receipt = (f, service, actionId = "accepted", receiptKey = key) =>
  f.request(path(service) + "/job-receipt", {
    session: null,
    body: { actionId, receiptKey },
  });
const run = (f, service) =>
  f.control({
    action: "host-diagnostic",
    identity: service.identity,
    kind: "sweep",
  });

test(
  "HTTP acceptance saves before acknowledging, a worker completes after full restart without a client, and replay never executes twice",
  { timeout: 25000 },
  async () => {
    let executions = 0;
    const f = await taskFixture({
      services: true,
      hostControl: async () => {
        executions++;
        return Response.json({});
      },
    });
    try {
      const service = await hosted(f, { agreement: agreement() });
      expectStatus(await control(f, service, "activate"), 200);
      const accepted = await submit(f, service);
      expectStatus(accepted, 202);
      assert.equal(accepted.body.job.status, "received");
      assert.equal(executions, 0);
      await f.restart();
      expectStatus(await run(f, service), 200);
      const complete = await receipt(f, service);
      expectStatus(complete, 200);
      assert.equal(complete.body.job.status, "confirmed");
      assert.equal(complete.body.job.result, "accepted");
      assert.equal(executions, 1);
      assert.deepEqual((await submit(f, service)).body, complete.body);
      expectStatus(await run(f, service), 200);
      assert.equal(executions, 1);
      expectStatus(await receipt(f, service, "accepted", "a".repeat(64)), 404);
      expectStatus(
        await f.request(path(service) + "/jobs", { session: f.otherCookie }),
        404,
      );
      expectStatus(
        await f.request(path(service) + "/jobs", { session: null }),
        401,
      );
      expectStatus(
        await f.request(path(service) + "/actions", {
          session: null,
          body: {
            actionId: "accepted",
            operation: "join",
            input: { name: "Guest" },
          },
        }),
        409,
      );
      const jobs = await f.request(path(service) + "/jobs");
      expectStatus(jobs, 200);
      assert.equal(jobs.body.jobs.length, 1);
      assert.equal(jobs.body.jobs[0].attempts, 1);
      assert.ok(!JSON.stringify(jobs.body).includes("viewerHash"));
    } finally {
      await f.close();
    }
  },
);

test(
  "pause holds accepted work, cancellation prevents dispatch, and another owner cannot inspect or control it",
  { timeout: 25000 },
  async () => {
    let executions = 0;
    const f = await taskFixture({
      services: true,
      hostControl: async () => {
        executions++;
        return Response.json({});
      },
    });
    try {
      const service = await hosted(f, { agreement: agreement() });
      expectStatus(await control(f, service, "activate"), 200);
      expectStatus(await submit(f, service), 202);
      expectStatus(await control(f, service, "pause"), 200);
      await run(f, service);
      assert.equal(executions, 0);
      assert.equal((await receipt(f, service)).body.job.status, "received");
      expectStatus(await control(f, service, "delete"), 409);
      expectStatus(
        await f.request(path(service) + "/job-control", {
          session: f.otherCookie,
          body: { actionId: "accepted", kind: "cancel" },
        }),
        404,
      );
      const cancelled = await f.request(path(service) + "/job-control", {
        body: { actionId: "accepted", kind: "cancel" },
      });
      expectStatus(cancelled, 200);
      assert.equal(cancelled.body.job.label, "Cancelled before completion");
      expectStatus(await control(f, service, "activate"), 200);
      await run(f, service);
      assert.equal(executions, 0);
      expectStatus(await control(f, service, "delete"), 200);
      // Server evidence survives removal of the component and of the Container's executable code.
      assert.equal((await receipt(f, service)).body.job.status, "failed");
    } finally {
      await f.close();
    }
  },
);

test(
  "an interrupted claimed job resumes from durable storage after its lease without a browser retry",
  { timeout: 25000 },
  async () => {
    let first = true,
      notify;
    const entered = new Promise((resolve) => {
      notify = resolve;
    });
    const f = await taskFixture({
      services: true,
      hostControl: async () => {
        if (first) {
          first = false;
          notify();
          await delay(900);
        }
        return Response.json({});
      },
    });
    try {
      const service = await hosted(f, { agreement: agreement() });
      expectStatus(await control(f, service, "activate"), 200);
      expectStatus(await submit(f, service), 202);
      const interrupted = run(f, service).catch(() => null);
      await entered;
      await f.restart();
      await interrupted;
      await f.control({ action: "time", now: NOW + 121000 });
      await run(f, service);
      const result = await receipt(f, service);
      expectStatus(result, 200);
      assert.equal(result.body.job.status, "confirmed");
      const jobs = await f.request(path(service) + "/jobs");
      assert.equal(jobs.body.jobs[0].attempts, 2);
      const stored = (
        await f.control({
          action: "host-diagnostic",
          identity: service.identity,
          kind: "inspect",
        })
      ).body;
      assert.equal(stored.receipts.length, 1);
      assert.equal(JSON.parse(stored.data[0].body).guests.length, 1);
    } finally {
      await f.close();
    }
  },
);

test(
  "a saved future schedule does not block a due job and cancelled schedules never dispatch after restart",
  { timeout: 25000 },
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const service = await hosted(f, { agreement: agreement() });
      expectStatus(await control(f, service, "activate"), 200);
      expectStatus(
        await submit(f, service, "future", {
          at: NOW + 60000,
          timezone: "Europe/London",
        }),
        202,
      );
      expectStatus(await submit(f, service, "due"), 202);
      await run(f, service);
      assert.equal(
        (await receipt(f, service, "due")).body.job.status,
        "confirmed",
      );
      assert.equal(
        (await receipt(f, service, "future")).body.job.status,
        "received",
      );
      expectStatus(
        await f.request(path(service) + "/job-control", {
          body: { actionId: "future", kind: "cancel" },
        }),
        200,
      );
      await f.restart();
      await f.control({ action: "time", now: NOW + 120000 });
      await run(f, service);
      assert.equal(
        (await receipt(f, service, "future")).body.job.status,
        "failed",
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "a real durable alarm starts scheduled work after worker restart with every browser closed",
  { timeout: 25000 },
  async () => {
    let executions = 0;
    const f = await taskFixture({
      services: true,
      realClock: true,
      hostControl: async () => {
        executions++;
        return Response.json({});
      },
    });
    try {
      const service = await hosted(f, { agreement: agreement() });
      expectStatus(await control(f, service, "activate"), 200);
      expectStatus(
        await submit(f, service, "alarm-job", {
          at: Date.now() + 1200,
          timezone: "Europe/London",
        }),
        202,
      );
      await f.restart();
      let value;
      const deadline = Date.now() + 10000;
      do {
        value = await receipt(f, service, "alarm-job");
        if (value.body.job.status === "confirmed") break;
        await delay(50);
      } while (Date.now() < deadline);
      assert.equal(value.body.job.status, "confirmed");
      assert.equal(executions, 1);
      // Creator inspection must not replace the running host clock with a frozen observation.
      await inspect(f, service);
      expectStatus(
        await submit(f, service, "after-inspection", {
          at: Date.now() + 1200,
          timezone: "Europe/London",
        }),
        202,
      );
      const secondDeadline = Date.now() + 10000;
      do {
        value = await receipt(f, service, "after-inspection");
        if (value.body.job.status === "confirmed") break;
        await delay(50);
      } while (Date.now() < secondDeadline);
      assert.equal(value.body.job.status, "confirmed");
      assert.equal(executions, 2);
    } finally {
      await f.close();
    }
  },
);

test(
  "paused jobs reach their lifetime without dispatch; unresolved evidence is retained and completed receipts expire",
  { timeout: 25000 },
  async () => {
    let executions = 0;
    const f = await taskFixture({
      services: true,
      hostControl: async () => {
        executions++;
        return Response.json({});
      },
    });
    try {
      const service = await hosted(f, { agreement: agreement() });
      expectStatus(await control(f, service, "activate"), 200);
      expectStatus(await submit(f, service, "expire"), 202);
      expectStatus(await submit(f, service, "cancel"), 202);
      expectStatus(await control(f, service, "pause"), 200);
      expectStatus(
        await f.request(path(service) + "/job-control", {
          body: { actionId: "cancel", kind: "cancel" },
        }),
        200,
      );
      await f.control({ action: "time", now: NOW + 7 * 86400000 + 1 });
      await run(f, service);
      assert.equal(
        (await receipt(f, service, "expire")).body.job.status,
        "needs_checking",
      );
      await f.control({ action: "time", now: NOW + 31 * 86400000 });
      await run(f, service);
      assert.equal(
        (await receipt(f, service, "expire")).body.job.status,
        "needs_checking",
      );
      expectStatus(await receipt(f, service, "cancel"), 404);
      assert.equal(executions, 0);
    } finally {
      await f.close();
    }
  },
);

test(
  "job capacity is bounded and private creator inspection omits submitted fields and receipt keys",
  { timeout: 25000 },
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const service = await hosted(f, { agreement: agreement() });
      expectStatus(await control(f, service, "activate"), 200);
      for (let index = 0; index < 128; index++)
        expectStatus(
          await submit(f, service, `queued-${index}`, {
            at: NOW + 60000,
            timezone: "Europe/London",
          }),
          202,
        );
      expectStatus(await submit(f, service, "over-capacity"), 429);
      const jobs = await f.request(path(service) + "/jobs");
      expectStatus(jobs, 200);
      assert.equal(jobs.body.jobs.length, 128);
      assert.ok(!JSON.stringify(jobs.body).includes(key));
      assert.ok(!JSON.stringify(jobs.body).includes("Guest"));
    } finally {
      await f.close();
    }
  },
);
