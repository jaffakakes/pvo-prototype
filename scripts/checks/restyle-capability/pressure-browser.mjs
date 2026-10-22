import assert from "node:assert/strict";
import {
  openIndependentViewer,
  fillGeneratedForm,
} from "../cloud-agent-first-release/viewer.mjs";
import { exportGenerated, requireVisible } from "./durable-delivery.mjs";
import { expectStatus } from "../../../tests/assistant-task-server/helpers.mjs";

async function inspectControls(frame, record) {
  const controls = frame.locator("input,button");
  await controls.first().waitFor();
  const facts = await controls.evaluateAll((elements) =>
    elements.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        name: el.getAttribute("name"),
        label: el.labels?.[0]?.textContent?.trim() ?? el.textContent?.trim(),
        visible: rect.width > 0 && rect.height > 0,
        fits:
          rect.left >= 0 &&
          rect.right <= document.documentElement.clientWidth + 1,
      };
    }),
  );
  await record("narrow_controls", { facts });
  assert.ok(
    facts.every((item) => item.visible && item.fits && item.label),
    "Every control needs a visible label and must fit the narrow frame.",
  );
}

/** Real generated UI, Try, export, anonymous mobile viewer and retained receipt. No source repair. */
export async function checkPressureBrowser(
  creator,
  fixture,
  directory,
  record,
  email,
  scenario,
) {
  const applied = await creator.apply();
  const form = applied.components.find((item) => item.type === "form");
  assert.ok(
    form?.serviceConnection,
    "A generated form must attach its checked operation.",
  );
  const page = creator.page;
  await page.evaluate(async () => {
    window.resultProbe.useCapture.getState().patch({ t: 0 });
    (await import("/src/features/preview/tryMode.ts")).startTry();
    window.resultProbe.useCapture.getState().patch({ playing: false });
  });
  const tryResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/try") && response.request().method() === "POST",
  );
  await fillGeneratedForm(
    page
      .locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]')
      .first()
      .contentFrame(),
    scenario.inputs.at(-1),
  );
  const tried = await tryResponse;
  assert.equal(tried.status(), 200);
  await record("try_response", {
    body: await tried.json(),
    providerCalls: email?.calls.length ?? 0,
  });
  assert.equal(email?.calls.length ?? 0, 0);
  await page.evaluate(async () =>
    (await import("/src/features/preview/tryMode.ts")).stopTry(),
  );
  if (email) {
    const connection = form.serviceConnection.connection;
    expectStatus(
      await fixture.request(
        `/api/services/${connection.serviceId}/account-access`,
        { body: { kind: "approve", releaseId: connection.releaseId } },
      ),
      200,
    );
    await record("controlled_creator_approval", {
      releaseId: connection.releaseId,
    });
  }
  const bytes = await exportGenerated(page, directory, record);
  let lastViewer;
  let publicCalls = 0;
  try {
    for (const [index, input] of scenario.inputs.entries()) {
      const viewer = await openIndependentViewer(creator.browser, bytes);
      lastViewer = viewer;
      await viewer.page.setViewportSize({ width: 390, height: 844 });
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
            await record("public_response", { index, body: response.body });
            if (scenario.privateFeedback)
              assert.ok(
                !JSON.stringify(response.body).includes("Private"),
                "Private data must not be returned publicly.",
              );
          }
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: response.body === null ? "" : JSON.stringify(response.body),
          });
        },
      );
      await inspectControls(viewer.frame, record);
      await viewer.page.screenshot({
        path: `${directory}/form-${index + 1}.png`,
      });
      // Reach and activate the submit control with a keyboard, after filling native fields.
      for (const [name, value] of Object.entries(input)) {
        const field = viewer.frame.locator(`[name="${name}"]`);
        if (typeof value === "boolean") await field.setChecked(value);
        else await field.fill(String(value));
      }
      const submit = viewer.frame.locator('button[type="submit"]');
      await submit.focus();
      await submit.press("Enter");
      await requireVisible(viewer.page, scenario.expected[index]);
      assert.equal(publicCalls, index + 1);
      if (email) assert.equal(email.calls.length, index === 0 ? 0 : 1);
      await viewer.page.screenshot({
        path: `${directory}/viewer-${index + 1}.png`,
      });
      assert.deepEqual(viewer.errors, []);
      if (index !== scenario.inputs.length - 1) {
        await viewer.close();
        lastViewer = null;
      }
    }
    await fixture.restart();
    await lastViewer.page.reload();
    await lastViewer.page.locator("#pvoInput").setInputFiles({
      name: "generated.pvo",
      mimeType: "application/vnd.pvo",
      buffer: bytes,
    });
    await lastViewer.page
      .getByRole("button", { name: "Show saved result", exact: true })
      .click();
    await requireVisible(lastViewer.page, scenario.expected.at(-1));
    assert.equal(
      publicCalls,
      scenario.inputs.length,
      "Reopen must not repeat the action.",
    );
    if (email) assert.equal(email.calls.length, 1);
    await record("viewer_reopened", {
      publicCalls,
      providerCalls: email?.calls.length ?? 0,
      errors: lastViewer.errors,
    });
  } finally {
    if (lastViewer) await lastViewer.close();
  }
  assert.deepEqual(creator.errors, []);
}
