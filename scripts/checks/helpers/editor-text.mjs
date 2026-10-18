/** Follow the text composer flow: dismiss the keyboard, then confirm the text. */
export async function finishTextEntry(dialog) {
  const keyboard = dialog.getByRole("button", { name: "Hide keyboard", exact: true });
  if (await keyboard.isVisible()) await keyboard.click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
}
