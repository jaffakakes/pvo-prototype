/** One optional recovery control per visible component. It never sends on mount. */
export function mountServiceRecovery({
  position,
  entry,
  services,
  isCurrent,
  recover,
  setStatus,
}) {
  if (!entry) return;
  const panel = document.createElement("div");
  panel.className = "service-recovery";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Checking saved submission…";
  button.disabled = true;
  panel.append(button);
  position.append(panel);
  let sequence = 0;
  async function refresh() {
    const current = ++sequence;
    try {
      const value = await services.readRecovery(entry);
      if (!isCurrent() || current !== sequence) return;
      panel.hidden = !value;
      if (!value) return;
      button.textContent = value.complete
        ? "Show saved result"
        : "Check saved submission";
      button.disabled = false;
    } catch {
      if (!isCurrent() || current !== sequence) return;
      panel.hidden = false;
      button.textContent = "Check saved submission";
      button.disabled = false;
    }
  }
  void refresh();
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!isCurrent() || button.disabled) return;
    button.disabled = true;
    try {
      await recover();
    } catch {
      if (isCurrent())
        setStatus("The saved submission could not be opened.", true);
    } finally {
      if (isCurrent()) button.disabled = false;
    }
  });
  return { refresh };
}
