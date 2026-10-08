import assert from "node:assert/strict";
import {
  hosted,
  publicCall,
  control,
  expectStatus,
} from "../../../tests/service-actions/helpers.mjs";
import { TOKEN } from "../../../tests/account-connections/helpers.mjs";
import { writeFixture } from "../../../tests/connected-services/fixtures.mjs";

/** Creator controls for an explicitly granted write with a controlled lost provider reply. */
export async function checkConnectedRecovery({
  page,
  fixture,
  local,
  providerState,
}) {
  await page.evaluate(() =>
    window.resultProbe.useCapture.getState().patch({ sheet: "more" }),
  );
  await page
    .getByRole("button", { name: "Manage connections", exact: true })
    .click();
  const manager = page.getByRole("region", {
    name: "Account connections",
    exact: true,
  });
  await manager.getByRole("button", { name: "Reconnect", exact: true }).click();
  const grant = manager.getByRole("checkbox", {
    name: "Allow issue creation for Containers I approve",
    exact: true,
  });
  assert.equal(await grant.isChecked(), false);
  await grant.check();
  await grant.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-2c-write-form-desktop.png" });
  await manager.getByLabel("Private access token", { exact: true }).fill(TOKEN);
  await manager
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await manager
    .getByText("octocat · Connected · issue creation allowed", { exact: true })
    .waitFor();
  const { agreement, source, input } = writeFixture();
  const service = await hosted(
    { ...fixture, project: () => fixture.project(local.localId) },
    { agreement, source },
  );
  expectStatus(
    await fixture.request(
      `/api/services/${service.identity.serviceId}/account-access`,
      { body: { kind: "approve", releaseId: service.identity.resourceId } },
    ),
    200,
  );
  expectStatus(await control(fixture, service, "activate"), 200);
  expectStatus(
    await publicCall(fixture, service, {
      actionId: "recover-from-ui",
      operation: "lookup",
      input,
    }),
    409,
  );
  assert.equal(providerState.writes, 1);
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  const container = page
    .getByRole("heading", { name: agreement.description, exact: true })
    .locator("..");
  await container
    .getByRole("button", { name: "Records and usage", exact: true })
    .click();
  const pending = container.getByRole("region", {
    name: "Pending outside action",
    exact: true,
  });
  await pending
    .getByRole("button", { name: "Resume saved action", exact: true })
    .waitFor();
  await pending.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-2c-pending-desktop.png" });
  await pending
    .getByRole("button", { name: "Resume saved action", exact: true })
    .click();
  await pending.getByRole("alert").waitFor();
  assert.equal(providerState.writes, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await container
    .getByRole("button", { name: "Records and usage", exact: true })
    .click();
  await pending.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-2c-pending-phone.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  providerState.found = true;
  await pending
    .getByRole("button", { name: "Resume saved action", exact: true })
    .click();
  await pending.waitFor({ state: "detached" });
  assert.equal(providerState.writes, 1);
  expectStatus(await control(fixture, service, "delete"), 200);
  console.log(
    "Private write opt-in and desktop/phone pending action inspection/resume passed; one controlled write only.",
  );
}
