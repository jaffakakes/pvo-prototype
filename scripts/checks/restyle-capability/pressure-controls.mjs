import assert from "node:assert/strict";

/** Use the browser's accessible name, including valid ARIA labels, not only <label> text. */
export async function inspectControls(frame, record) {
  const controls = frame.locator("input,button");
  await controls.first().waitFor();
  const facts = [];
  for (const control of await controls.all()) {
    const snapshot = await control.ariaSnapshot();
    const label = /^- \w+ "((?:[^"\\]|\\.)+)"/m.exec(snapshot)?.[1] ?? "";
    const bounds = await control.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        name: el.getAttribute("name"),
        visible: rect.width > 0 && rect.height > 0,
        fits:
          rect.left >= 0 &&
          rect.right <= document.documentElement.clientWidth + 1,
      };
    });
    facts.push({ ...bounds, label, snapshot });
  }
  await record("narrow_controls", { facts });
  assert.ok(
    facts.every((item) => item.visible && item.fits && item.label),
    "Every control needs an accessible label and must fit the narrow frame.",
  );
}
