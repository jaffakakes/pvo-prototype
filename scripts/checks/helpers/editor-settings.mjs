/** Open project settings from the desktop inspector, then restore the test viewport. */
export async function openEditorSettings(page) {
  const viewport = page.viewportSize();
  if (!viewport)
    throw new Error("Settings checks require an explicit viewport");
  const settings = page.getByRole("dialog", { name: "More", exact: true });
  await page.setViewportSize({
    width: Math.max(1280, viewport.width),
    height: Math.max(800, viewport.height),
  });
  try {
    await page
      .getByRole("button", { name: "Project settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "More settings", exact: true })
      .click();
    await settings.waitFor();
  } finally {
    await page.setViewportSize(viewport);
  }
  await settings.waitFor();
}
