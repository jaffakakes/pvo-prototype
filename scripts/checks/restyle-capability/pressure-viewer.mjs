import assert from "node:assert/strict";
import { openIndependentViewer } from "../cloud-agent-first-release/viewer.mjs";
import { requireVisible } from "./durable-delivery.mjs";
import { inspectControls } from "./pressure-controls.mjs";

/** Exercise unchanged exported bytes through the real anonymous player and host adapter. */
export async function checkPressureViewer(
  creator,
  fixture,
  bytes,
  directory,
  record,
  email,
  scenario,
) {
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
}
