import { watchServiceReceipt } from "../../packages/pvo-assistant/attachments/index.js";

/** One optional recovery surface per visible component; automatic checks can only read an existing job. */
export function mountServiceRecovery({
  position,
  surface = position,
  entry,
  services,
  isCurrent,
  recover,
  setStatus,
  onReceipt,
  onLayout = () => {},
}) {
  if (!entry) return;
  let area = surface.querySelector(":scope > .service-recovery-area");
  if (!area) {
    area = document.createElement("div");
    area.className = "service-recovery-area";
    surface.append(area);
  }
  const panel = document.createElement("div");
  panel.className = "service-recovery";
  panel.hidden = true;
  const label = document.createElement("p");
  label.setAttribute("role", "status");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Checking saved submission…";
  button.disabled = true;
  const link = document.createElement("a");
  link.textContent = "Save private receipt link";
  link.referrerPolicy = "no-referrer";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.hidden = true;
  const notice = document.createElement("p");
  notice.textContent =
    "Private link: anyone with it can read this result. Save it to return later.";
  notice.hidden = true;
  panel.append(label, button, link, notice);
  area.append(panel);
  const watcher = watchServiceReceipt({
    read: () => services.readRecovery(entry),
    check: (signal, actionId) =>
      services.checkReceipt(entry, signal, actionId, isCurrent),
    isCurrent,
    onValue(value) {
      panel.hidden = !value;
      if (!value) {
        onLayout();
        return;
      }
      button.textContent = value.complete
        ? "Show saved result"
        : "Check saved submission";
      button.disabled = false;
      label.textContent = value.receipt?.job.label ?? "";
      link.hidden = notice.hidden = !value.link;
      if (value.link) link.href = value.link;
      if (value.receipt) onReceipt?.(value.receipt);
      onLayout();
    },
    onError() {
      panel.hidden = false;
      label.textContent =
        "Status unavailable. The saved server job can continue; check again later.";
      button.textContent = "Check saved submission";
      button.disabled = false;
      onLayout();
    },
  });
  const click = async (event) => {
    event.stopPropagation();
    if (!isCurrent() || button.disabled) return;
    button.disabled = true;
    try {
      await recover();
      await watcher.refresh();
    } catch {
      if (isCurrent())
        setStatus("The saved submission could not be opened.", true);
    } finally {
      if (isCurrent()) button.disabled = false;
    }
  };
  button.addEventListener("click", click);
  return {
    refresh: watcher.refresh,
    dispose() {
      watcher.dispose();
      button.removeEventListener("click", click);
      panel.remove();
      if (!area.children.length) area.remove();
      onLayout();
    },
  };
}
