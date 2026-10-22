import assert from "node:assert/strict";
import { expectStatus } from "../../../tests/assistant-task-server/helpers.mjs";
import { openIndependentViewer } from "../cloud-agent-first-release/viewer.mjs";
import { exportGenerated, requireVisible } from "./durable-delivery.mjs";

const address = "reliability-agent@agentmail.to";
const receipt = "<reliability-message@agentmail.to>";
const token = "am_us_synthetic_reliability_key_never_real_123456789";
const intended = {
  to: ["friend@example.com"],
  subject: "Thanks",
  text: "Thanks for watching",
};

/** Only account effects are simulated. Generated source and the real vault/adapter remain in use. */
export function controlledEmail() {
  const sends = new Map();
  const calls = [];
  return {
    sends,
    calls,
    async connectionFetch(request) {
      const url = new URL(request.url);
      assert.equal(url.hostname, "api.agentmail.to");
      assert.equal(request.headers.get("Authorization"), `Bearer ${token}`);
      if (
        request.method === "GET" &&
        url.pathname === `/v0/inboxes/${encodeURIComponent(address)}`
      )
        return Response.json({
          inbox_id: address,
          email: address,
          pod_id: "pod-reliability",
          status: "active",
        });
      assert.equal(request.method, "POST");
      assert.equal(
        url.pathname,
        `/v0/inboxes/${encodeURIComponent(address)}/messages/send`,
      );
      const body = await request.json();
      assert.deepEqual(body, intended);
      const key = request.headers.get("Idempotency-Key");
      assert.ok(key);
      if (sends.has(key)) assert.deepEqual(sends.get(key), body);
      sends.set(key, body);
      calls.push({ method: request.method, path: url.pathname, key, body });
      return Response.json({
        message_id: receipt,
        thread_id: "reliability-thread",
      });
    },
    async researchFetch(request) {
      const url = new URL(request.url);
      assert.equal(request.headers.get("Authorization"), null);
      assert.equal(request.headers.get("Cookie"), null);
      if (
        !["dns.google", "docs.agentmail.to", "www.agentmail.to"].includes(
          url.hostname,
        )
      )
        return new Response(null, { status: 503 });
      return fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: request.signal,
      });
    },
    async seed(fixture) {
      const owner = (await fixture.request("/api/auth/session")).body.user.id;
      expectStatus(
        await fixture.request("/api/agent-identity/import", {
          headers: { "X-Restyle-Owner": owner },
          body: {
            provider: "agentmail",
            expectedRevision: 0,
            resourceId: address,
            token,
            consent: true,
          },
        }),
        200,
      );
      const connected = await fixture.request(
        "/api/account-connections/connect",
        {
          headers: { "X-Restyle-Owner": owner },
          body: {
            id: "email-sender",
            expectedRevision: 0,
            setup: { provider: "agentmail", recipient: intended.to[0] },
            token: "",
          },
        },
      );
      expectStatus(connected, 200);
      assert.equal(connected.body.connection.status, "connected");
      assert.equal(sends.size, 0);
    },
  };
}

async function clickGeneratedButton(page, frame) {
  const buttons = frame.getByRole("button");
  await buttons.first().waitFor();
  assert.equal(
    await buttons.count(),
    1,
    "The requested fixed email needs one unambiguous button.",
  );
  await buttons.click();
  await requireVisible(page, receipt);
}

/** Try is offline; a separate viewer invokes the controlled account once and reopening replays its receipt. */
export async function checkEmailDelivery(
  creator,
  fixture,
  directory,
  record,
  email,
) {
  const applied = await creator.apply();
  assert.equal(
    applied.components.filter((item) => item.serviceConnection).length,
    1,
  );
  const page = creator.page;
  await page.evaluate(async () => {
    window.resultProbe.useCapture.getState().patch({ t: 0 });
    (await import("/src/features/preview/tryMode.ts")).startTry();
    window.resultProbe.useCapture.getState().patch({ playing: false });
  });
  const responseEvent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/try") && response.request().method() === "POST",
  );
  const frame = page
    .locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]')
    .first()
    .contentFrame();
  await frame.getByRole("button").click();
  const response = await responseEvent;
  assert.equal(response.status(), 200);
  const tryBody = await response.json();
  const build = (
    await fixture.control({ action: "builder-state", id: creator.task.id })
  ).body;
  const exampleReceipt =
    build.agreement.body.connections[0].examples[0].result.id;
  assert.equal(typeof exampleReceipt, "string");
  assert.ok(JSON.stringify(tryBody).includes(exampleReceipt));
  await requireVisible(page, exampleReceipt);
  await record("try_response", {
    body: tryBody,
    providerCalls: email.calls.length,
  });
  assert.equal(email.calls.length, 0, "Try must never send email.");
  await page.screenshot({ path: directory + "/try-results.png" });
  await page.evaluate(async () =>
    (await import("/src/features/preview/tryMode.ts")).stopTry(),
  );
  const connection = applied.components.find((item) => item.serviceConnection)
    .serviceConnection.connection;
  await page
    .getByRole("button", { name: "More settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: "Checked version account access" })
    .click();
  const access = page.getByRole("region", {
    name: "Checked version account access",
    exact: true,
  });
  const approvalEvent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/account-access") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON().kind === "approve",
  );
  await access
    .getByRole("button", { name: "Approve this version’s access", exact: true })
    .click();
  const approval = await approvalEvent;
  assert.equal(approval.status(), 200);
  assert.equal(
    approval.request().postDataJSON().releaseId,
    connection.releaseId,
  );
  await access.getByText(/Approved for this version/).waitFor();
  const publicationEvent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/activate") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Publish checked version", exact: true })
    .click();
  assert.equal((await publicationEvent).status(), 200);
  assert.equal(email.calls.length, 0);
  await record("creator_approved_checked_version", {
    releaseId: connection.releaseId,
    providerCalls: 0,
  });
  await page.evaluate(() =>
    window.resultProbe.useCapture.getState().patch({ sheet: null }),
  );
  const bytes = await exportGenerated(page, directory, record);
  const viewer = await openIndependentViewer(creator.browser, bytes);
  let publicCalls = 0;
  try {
    await viewer.context.route(
      creator.origin + "/api/services/**",
      async (route) => {
        const request = route.request();
        assert.equal((await request.allHeaders()).cookie, undefined);
        const response = await fixture.request(
          new URL(request.url()).pathname,
          {
            method: request.method(),
            session: null,
            headers: { Origin: viewer.origin },
            ...(request.postData() ? { body: request.postDataJSON() } : {}),
          },
        );
        assert.equal(
          response.status,
          request.method() === "OPTIONS" ? 204 : 200,
          JSON.stringify(response.body),
        );
        if (request.method() === "POST") {
          publicCalls++;
          await record("public_response", { body: response.body });
        }
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: response.body === null ? "" : JSON.stringify(response.body),
        });
      },
    );
    await clickGeneratedButton(viewer.page, viewer.frame);
    assert.equal(email.sends.size, 1);
    assert.equal(email.calls.length, 1);
    assert.equal(publicCalls, 1);
    await viewer.page.screenshot({ path: directory + "/viewer-results.png" });
    await fixture.restart();
    await viewer.page.reload();
    await viewer.page.locator("#pvoInput").setInputFiles({
      name: "generated.pvo",
      mimeType: "application/vnd.pvo",
      buffer: bytes,
    });
    await viewer.page
      .getByRole("button", { name: "Show saved result", exact: true })
      .click();
    await requireVisible(viewer.page, receipt);
    assert.equal(email.calls.length, 1);
    assert.equal(publicCalls, 1);
    assert.deepEqual(viewer.errors, []);
    await record("viewer_reopened", {
      publicCalls,
      controlledProviderCalls: email.calls,
      uniqueSends: email.sends.size,
    });
  } finally {
    await viewer.close();
  }
  assert.deepEqual(creator.errors, []);
}
