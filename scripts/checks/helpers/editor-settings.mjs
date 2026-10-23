/** Open the current header dropdown on either editor layout. */
export async function openEditorSettings(page) {
  const trigger = page.getByRole("button", {
    name: /^(Project settings|Editor settings)$/,
  });
  const desktop = page.locator("[data-desktop-editor]");
  if (await desktop.count())
    await page
      .getByRole("button", { name: "Editor settings", exact: true })
      .click();
  else await trigger.click();
  await page
    .getByRole("dialog", { name: /^(Project settings|Editor settings)$/ })
    .waitFor();
}

export async function closeEditorSettings(page) {
  const settings = page.getByRole("dialog", {
    name: /^(Project settings|Editor settings)$/,
  });
  await settings.press("Escape");
  await settings.waitFor({ state: "hidden" });
}
