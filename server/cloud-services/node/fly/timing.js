/** Provider polling and pacing release their timer immediately when the owning execution stops. */
export function waitForFly(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const clear = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      clear();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      clear();
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export const flyClock = { now: () => Date.now(), sleep: waitForFly };
