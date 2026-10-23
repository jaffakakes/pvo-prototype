import {
  HOSTED_SERVICE_LIMITS as limits,
  serviceCallError,
} from "../../packages/pvo-assistant/hosting/index.js";

/** Bound waiting requests and serialize the entire read/execute/commit workflow across awaits. */
export class ServiceCallQueue {
  constructor() {
    this.tail = Promise.resolve();
    this.pending = 0;
    this.active = null;
  }
  async run(operation) {
    if (this.pending >= limits.queued)
      throw serviceCallError(
        "busy",
        "This service is busy. Retry the same action.",
      );
    this.pending++;
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      return await operation();
    } finally {
      this.pending--;
      release();
    }
  }
  cancel(resourceId) {
    if (this.active?.resourceId === resourceId) this.active.controller.abort();
  }
}
