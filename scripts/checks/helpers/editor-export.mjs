/** Open from the desktop header, then restore the viewport under test. */
export async function openExportDialog(page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Export checks require an explicit viewport");
  const dialog = page.locator("dialog[data-state]");
  await page.setViewportSize({
    width: Math.max(1280, viewport.width),
    height: Math.max(800, viewport.height),
  });
  try {
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Export", exact: true })
      .click();
    await dialog.waitFor();
  } finally {
    await page.setViewportSize(viewport);
  }
  await dialog.waitFor();
}
