/** A visible host owns one bounded, sequential receipt watcher. Disposing it never cancels server work. */
export function watchServiceReceipt({
  read,
  check,
  onValue,
  onError = () => {},
  isCurrent,
  signal,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (value) => clearTimeout(value),
  maxChecks = 12,
}) {
  const controller = new AbortController();
  let timer = null,
    generation = 0,
    checks = 0,
    running = false;
  const current = () =>
    !controller.signal.aborted && !signal?.aborted && isCurrent();
  const abort = () => dispose();
  signal?.addEventListener("abort", abort, { once: true });
  async function refresh({ manual = false } = {}) {
    if (!current() || running) return;
    running = true;
    const sequence = ++generation;
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    try {
      let value = await read();
      if (!current() || sequence !== generation) return;
      if (
        value?.background &&
        ((!value.complete && checks < maxChecks) || manual)
      ) {
        if (!manual) checks++;
        value = await check(controller.signal, value.actionId);
      }
      if (!current() || sequence !== generation) return;
      onValue(value);
      if (
        value?.background &&
        ["received", "pending"].includes(value.receipt?.job.status) &&
        checks < maxChecks
      )
        timer = schedule(
          () => {
            timer = null;
            void refresh();
          },
          Math.min(30000, 5000 * 2 ** Math.min(checks - 1, 3)),
        );
    } catch (error) {
      if (current() && sequence === generation) onError(error);
    } finally {
      running = false;
    }
  }
  function dispose() {
    if (controller.signal.aborted) return;
    controller.abort();
    generation++;
    if (timer !== null) cancel(timer);
    timer = null;
    signal?.removeEventListener("abort", abort);
  }
  void refresh();
  return { refresh, dispose };
}
