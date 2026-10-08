import {
  parseReceiptLink,
  watchServiceReceipt,
} from "/packages/pvo-assistant/attachments/index.js";
import {
  parseJobReceipt,
  advanceJobReceipt,
} from "/packages/pvo-assistant/jobs/index.js";
import { readServiceReceipt } from "/packages/pvo-assistant/attachments/transport.js";

const status = document.getElementById("status"),
  result = document.getElementById("result"),
  refresh = document.getElementById("refresh");
const lifetime = new AbortController();
let watcher,
  saved = null;
try {
  const reference = parseReceiptLink(
    JSON.parse(decodeURIComponent(location.hash.slice(1))),
  );
  // The fragment stays on the page for bookmarking; it is never sent in an HTTP path or a referrer.
  async function check(signal) {
    refresh.disabled = true;
    try {
      const value = await readServiceReceipt(
        location.origin,
        reference,
        fetch,
        AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      );
      saved = advanceJobReceipt(
        saved,
        parseJobReceipt(value, reference.actionId),
      );
      return view();
    } finally {
      refresh.disabled = false;
    }
  }
  const view = () => ({
    actionId: reference.actionId,
    background: true,
    complete:
      saved !== null && ["confirmed", "failed"].includes(saved.job.status),
    receipt: saved,
  });
  watcher = watchServiceReceipt({
    read: async () => view(),
    check,
    signal: lifetime.signal,
    isCurrent: () => !lifetime.signal.aborted,
    onValue(value) {
      if (!value.receipt) return;
      status.textContent = value.receipt.job.label;
      result.hidden = value.receipt.job.result === null;
      result.textContent =
        typeof value.receipt.job.result === "string"
          ? value.receipt.job.result
          : JSON.stringify(value.receipt.job.result, null, 2);
    },
    onError(error) {
      result.hidden = true;
      result.textContent = "";
      status.textContent =
        error?.status === 404
          ? "This receipt is unavailable or has expired. Check that you opened the complete private link."
          : "Status is unavailable. Your server job can continue; check again later.";
    },
  });
  refresh.addEventListener("click", () => {
    void watcher.refresh({ manual: true });
  });
} catch {
  status.textContent =
    "This receipt link is incomplete. Open the original private link, including everything after #.";
  refresh.hidden = true;
}
addEventListener(
  "pagehide",
  () => {
    lifetime.abort();
    watcher?.dispose();
  },
  { once: true },
);
// A different private link is a different capability. Rebuild the page's scope,
// aborting the old watcher and clearing its result before reading the new key.
addEventListener("hashchange", () => location.reload(), { once: true });
