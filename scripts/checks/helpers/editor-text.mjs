/** Follow the text composer flow: dismiss the keyboard, then confirm the text. */
export async function finishTextEntry(dialog) {
  const keyboard = dialog.getByRole("button", {
    name: "Hide keyboard",
    exact: true,
  });
  if (await keyboard.isVisible()) await keyboard.click();
  const page = dialog.page();
  const viewport = page.viewportSize();
  const desktop = viewport.width >= 1024 && viewport.width > viewport.height;
  await (
    desktop
      ? dialog.getByRole("button", { name: "Done", exact: true })
      : page.getByRole("button", { name: "Close sheet", exact: true })
  ).click();
}
