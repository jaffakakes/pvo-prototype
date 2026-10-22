import assert from "node:assert/strict";
import test from "node:test";
import { identityTransport } from "../../server/agent-identity/transport.js";
import { MAIL_KEY } from "./helpers.mjs";

test("fixed origin, denied redirects, reflected keys, bounded bytes and late transport deadlines", async () => {
  const calls = [];
  const transport = identityTransport("agentmail", async (url, options) => {
    calls.push({ url, options });
    return Response.json({ message: MAIL_KEY });
  });
  await assert.rejects(transport("/v0/inboxes/test", { token: MAIL_KEY }));
  assert.equal(calls[0].url, "https://api.agentmail.to/v0/inboxes/test");
  assert.equal(calls[0].options.redirect, "manual");
  await assert.rejects(
    transport("//malicious.example/token", { token: MAIL_KEY }),
  );
  assert.equal(calls.length, 1);
  await assert.rejects(
    identityTransport(
      "agentmail",
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://other.example" },
        }),
    )("/v0/inboxes/test"),
  );
  await assert.rejects(
    identityTransport("agentmail", async () =>
      Response.json({ text: "x".repeat(70000) }),
    )("/v0/inboxes/test"),
  );
  await assert.rejects(
    identityTransport(
      "agentmail",
      () => new Promise(() => {}),
      20,
    )("/v0/inboxes/test"),
  );
});
