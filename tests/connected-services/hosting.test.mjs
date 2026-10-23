import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  provider,
  connectInput,
} from "../account-connections/helpers.mjs";
import {
  expectStatus,
  hosted,
  call,
  publicCall,
  control,
  version,
} from "../service-actions/helpers.mjs";
import {
  connectedAgreement,
  connectedSource,
  writeAdapter,
} from "./fixtures.mjs";

const access = (f, service, kind, options = {}) =>
  f.request(`/api/services/${service.identity.serviceId}/account-access`, {
    ...options,
    body: { kind, releaseId: service.identity.resourceId },
  });

test(
  "an approved Container invokes a connected account, Try stays offline and revocation fences new calls",
  { timeout: 30000 },
  async () => {
    const api = provider();
    let reads = 0;
    const f = await fixture({
      services: true,
      connectionFetch: async (request) => {
        if (new URL(request.url).pathname.endsWith("/issues/7")) {
          reads++;
          return Response.json({
            title: "Actual title",
            surplus: "never leaves the provider adapter",
          });
        }
        return api.fetch(request);
      },
    });
    try {
      expectStatus(await f.connection("connect", connectInput()), 200);
      const service = await hosted(f, {
        agreement: connectedAgreement(),
        source: connectedSource().files[0].content,
      });
      const action = {
        actionId: "read-one",
        operation: "lookup",
        input: { number: 7 },
      };
      const trial = await call(f, service, action);
      expectStatus(trial, 200);
      assert.equal(trial.body.result, "Saved example");
      assert.equal(reads, 0);
      expectStatus(await control(f, service, "activate"), 403);
      expectStatus(
        await access(f, service, "approve", { session: f.otherCookie }),
        404,
      );
      const approval = await access(f, service, "approve");
      expectStatus(approval, 200);
      assert.equal(
        approval.body.bindings[0].repository,
        "octocat/private-work",
      );
      expectStatus(await control(f, service, "activate"), 200);
      const actual = await publicCall(f, service, action);
      expectStatus(actual, 200);
      assert.equal(actual.body.result, "Actual title");
      assert.equal(reads, 1);
      await f.restart();
      assert.deepEqual(
        (await publicCall(f, service, action)).body,
        actual.body,
      );
      assert.equal(reads, 1);
      const updated = await version(f, service, {
        agreement: connectedAgreement(),
        source: connectedSource().files[0].content + "\n// Changed version",
      });
      expectStatus(await control(f, updated, "activate"), 403);
      expectStatus(await access(f, service, "revoke"), 200);
      expectStatus(
        await publicCall(f, service, { ...action, actionId: "unapproved" }),
        403,
      );
      expectStatus(await access(f, service, "approve"), 200);
      expectStatus(
        await f.connection("disconnect", {
          id: "connection-one",
          expectedRevision: 1,
        }),
        200,
      );
      expectStatus(
        await publicCall(f, service, { ...action, actionId: "revoked" }),
        409,
      );
      assert.equal(reads, 1);
      const records = await f.request(
        `/api/services/${service.identity.serviceId}/records`,
      );
      assert.equal(
        records.body.areas.find((area) => area.mode === "live").pending,
        null,
        "Failed reads have no uncertain external write",
      );
      expectStatus(await control(f, service, "delete"), 200);
    } finally {
      await f.close();
    }
  },
);

test(
  "lost write replies retain intent across restart and inspect the original request without resending",
  { timeout: 30000 },
  async () => {
    const api = provider();
    let writes = 0,
      found = false,
      created;
    const f = await fixture({
      services: true,
      connectionFetch: async (request) => {
        if (request.method === "POST") {
          writes++;
          const body = await request.json();
          created = { ...body, number: 42, user: { login: "octocat" } };
          return Response.json(
            { message: "controlled lost reply" },
            { status: 503 },
          );
        }
        const url = new URL(request.url);
        if (url.searchParams.has("creator"))
          return Response.json(found ? [created] : []);
        return api.fetch(request);
      },
    });
    try {
      expectStatus(
        await f.connection("connect", {
          ...connectInput(),
          setup: { ...connectInput().setup, access: "issues_write" },
        }),
        200,
      );
      const agreement = connectedAgreement(),
        adapter = writeAdapter(),
        input = { title: "Requested action", body: "Controlled test" };
      agreement.operations[0] = {
        ...agreement.operations[0],
        access: "write",
        input: adapter.input,
        result: adapter.result.fields[0].schema,
      };
      agreement.connections[0] = {
        ...agreement.connections[0],
        adapter,
        examples: [{ input, result: { number: 42 } }],
      };
      agreement.cases[0].steps[0] = {
        ...agreement.cases[0].steps[0],
        input,
        requests: [{ connection: "issue", input }],
        expected: { result: 42, state: null },
      };
      const source = connectedSource().files[0].content.replace(
        ".result.title",
        ".result.number",
      );
      const service = await hosted(f, { agreement, source });
      const action = { actionId: "write-once", operation: "lookup", input };
      expectStatus(await call(f, service, action), 200);
      assert.equal(writes, 0);
      expectStatus(await access(f, service, "approve"), 200);
      expectStatus(await control(f, service, "activate"), 200);
      const unknown = await publicCall(f, service, action);
      expectStatus(unknown, 409);
      assert.match(unknown.body.error, /needs checking/);
      assert.equal(writes, 1);
      expectStatus(await control(f, service, "delete"), 409);
      const records = await f.request(
        `/api/services/${service.identity.serviceId}/records`,
      );
      expectStatus(records, 200);
      assert.equal(
        records.body.areas.find((area) => area.mode === "live").pending
          .actionId,
        action.actionId,
      );
      await f.restart();
      expectStatus(
        await publicCall(f, service, { ...action, actionId: "different" }),
        409,
      );
      expectStatus(await publicCall(f, service, action), 409);
      assert.equal(writes, 1);
      found = true;
      const checked = await f.request(
        `/api/services/${service.identity.serviceId}/resume-account-action`,
        { body: { actionId: action.actionId } },
      );
      expectStatus(checked, 200);
      assert.equal(checked.body.result, 42);
      assert.equal(writes, 1);
      assert.deepEqual(
        (await publicCall(f, service, action)).body,
        checked.body,
      );
      assert.equal(writes, 1);
      expectStatus(await control(f, service, "delete"), 200);
    } finally {
      await f.close();
    }
  },
);

test("a bad terminal result after a read leaves no permanent outside-write blocker", async () => {
  const api = provider();
  const f = await fixture({
    services: true,
    connectionFetch: (request) =>
      new URL(request.url).pathname.endsWith("/issues/7")
        ? Response.json({ title: "Actual title" })
        : api.fetch(request),
  });
  try {
    expectStatus(await f.connection("connect", connectInput()), 200);
    const source = connectedSource().files[0].content.replace(
      "connectionResults[0].result.title",
      "123",
    );
    const service = await hosted(f, {
      agreement: connectedAgreement(),
      source,
    });
    expectStatus(await access(f, service, "approve"), 200);
    expectStatus(await control(f, service, "activate"), 200);
    const result = await publicCall(f, service, {
      actionId: "invalid-terminal",
      operation: "lookup",
      input: { number: 7 },
    });
    assert.notEqual(result.status, 200);
    const records = await f.request(
      `/api/services/${service.identity.serviceId}/records`,
    );
    assert.equal(
      records.body.areas.find((area) => area.mode === "live").pending,
      null,
    );
    expectStatus(await control(f, service, "delete"), 200);
  } finally {
    await f.close();
  }
});
