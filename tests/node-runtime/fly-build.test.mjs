import test from "node:test";
import assert from "node:assert/strict";
import { flyBuildCredentials } from "../../scripts/checks/node-runtime/fly/credentials.mjs";
import { flyFetch } from "../../scripts/checks/node-runtime/fly/connection.mjs";

test("Fly reconnects before TLS but never resubmits an uncertain mutation", async () => {
  let calls = 0;
  const options = { method: "POST", signal: AbortSignal.timeout(1000) };
  const response = await flyFetch(
    async () => {
      if (calls++ === 0)
        throw Object.assign(new TypeError("fetch failed"), {
          cause: {
            code: "ECONNRESET",
            message:
              "Client network socket disconnected before secure TLS connection was established",
          },
        });
      return Response.json({ accepted: true });
    },
    "https://api.fly.io/graphql",
    options,
  );
  assert.equal((await response.json()).accepted, true);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    flyFetch(
      async () => {
        calls++;
        throw Object.assign(new TypeError("fetch failed"), {
          cause: { code: "ECONNRESET", message: "socket hang up" },
        });
      },
      "https://api.fly.io/graphql",
      options,
    ),
  );
  assert.equal(calls, 1);
});

function fixture({ lostReply = false, wrongOrg = false } = {}) {
  const report = {
    id: "a".repeat(24),
    org: "example",
    app: `restyle-node-proof-${"a".repeat(24)}`,
    appVerified: true,
  };
  const snapshots = [];
  const calls = [];
  let issued = false;
  let revoked = false;
  const resources = {
    report,
    save: async () => snapshots.push(JSON.stringify(report)),
  };
  const credentials = flyBuildCredentials("private-control-token", resources, {
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.fly.io/graphql");
      const { query, variables } = JSON.parse(options.body);
      calls.push({ query, variables });
      let data;
      if (query.includes("createLimitedAccessToken")) {
        assert.equal(report.buildCredential.attempted, true);
        assert.equal(variables.profile, "deploy");
        assert.deepEqual(variables.profileParams, { app_id: report.app });
        assert.equal(variables.expiry, "15m");
        issued = true;
        if (lostReply) throw new TypeError("lost mutation response");
        data = {
          createLimitedAccessToken: {
            limitedAccessToken: {
              id: "owned-token-id",
              expiresAt: "2026-10-07T12:45:00Z",
              tokenHeader: "private-registry-token",
            },
          },
        };
      } else if (query.includes("deleteLimitedAccessToken")) {
        assert.equal(variables.input.id, "owned-token-id");
        revoked = true;
        data = {
          deleteLimitedAccessToken: { token: "private-registry-token" },
        };
      } else if (query.includes("limitedAccessTokens")) {
        data = {
          organization: {
            limitedAccessTokens: {
              nodes: [
                { id: "foreign", name: "preserve-this", revokedAt: null },
                ...(issued
                  ? [
                      {
                        id: "owned-token-id",
                        name: `restyle-image-${report.id}`,
                        revokedAt: revoked ? "now" : null,
                      },
                    ]
                  : []),
              ],
            },
          },
        };
      } else
        data = {
          organization: {
            id: wrongOrg ? "wrong-id" : "org-id",
            slug: "personal",
          },
          app: { name: report.app, organization: { id: "org-id" } },
        };
      return Response.json({ data });
    },
  });
  return { credentials, report, snapshots, calls };
}

test("trusted image builder gets one app-scoped expiring token; receipts contain no secret", async () => {
  const { credentials, report, snapshots, calls } = fixture();
  assert.equal(await credentials.create(), "private-registry-token");
  await assert.rejects(credentials.create(), /never retried/);
  await credentials.revoke();
  await credentials.revoke();
  assert.equal(report.buildCredential.revoked, true);
  assert.equal(
    calls.filter((call) => call.query.includes("deleteLimitedAccessToken"))
      .length,
    1,
  );
  assert.equal(
    snapshots.some((value) => value.includes("private-")),
    false,
  );
});

test("lost registry-token creation reply is recovered by exact owned name without minting again", async () => {
  const { credentials, report, calls } = fixture({ lostReply: true });
  await assert.rejects(credentials.create(), /lost mutation/);
  await credentials.revoke();
  assert.equal(report.buildCredential.revoked, true);
  assert.equal(
    calls.filter((call) => call.query.includes("createLimitedAccessToken"))
      .length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.query.includes("deleteLimitedAccessToken"))
      .length,
    1,
  );
});

test("registry credential minting fails closed on a different organisation", async () => {
  const { credentials, calls } = fixture({ wrongOrg: true });
  await assert.rejects(credentials.create());
  assert.equal(
    calls.filter((call) => call.query.includes("createLimitedAccessToken"))
      .length,
    0,
  );
});
