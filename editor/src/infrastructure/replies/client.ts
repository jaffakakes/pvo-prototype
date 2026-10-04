type Options = { origin?: string; fetch?: typeof fetch; timeoutMs?: number };

export type ReplyBox = {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  count: number;
};

export type ReplyAnswer = { name: string; type: "text" | "number" | "yesno"; value: string | number | boolean };
export type CollectedReply = { id: string; createdAt: string; answers: ReplyAnswer[] };

export class RepliesHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "RepliesHttpError";
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid replies response.");
  return value as Record<string, unknown>;
}

function string(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error("Invalid replies response.");
  return value;
}

function identifier(value: unknown): string {
  const id = string(value, 128);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(id)) throw new Error("Invalid replies response.");
  return id;
}

function box(value: unknown, origin: string, withCount: boolean): ReplyBox {
  const input = object(value);
  const id = identifier(input.id);
  const url = new URL(string(input.url, 500), origin);
  if (url.origin !== origin || url.username || url.password || url.pathname !== `/api/reply-boxes/${id}/replies`
    || url.search || url.hash) throw new Error("Invalid reply destination.");
  const count = withCount ? input.count : 0;
  if (!Number.isSafeInteger(count) || (count as number) < 0) throw new Error("Invalid replies response.");
  return {
    id,
    title: string(input.title, 120),
    url: url.href,
    createdAt: withCount ? string(input.createdAt, 80) : "",
    count: count as number,
  };
}

function replies(value: unknown): CollectedReply[] {
  const rows = object(value).replies;
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error("Invalid replies response.");
  return rows.map(value => {
    const row = object(value);
    if (!Array.isArray(row.answers) || row.answers.length > 5) throw new Error("Invalid replies response.");
    const answers = row.answers.map(value => {
      const answer = object(value);
      if (answer.type !== "text" && answer.type !== "number" && answer.type !== "yesno")
        throw new Error("Invalid replies response.");
      if (!["string", "number", "boolean"].includes(typeof answer.value)
        || String(answer.value).length > 1024) throw new Error("Invalid replies response.");
      return { name: string(answer.name, 24), type: answer.type as ReplyAnswer["type"],
        value: answer.value as string | number | boolean };
    });
    return { id: identifier(row.id), createdAt: string(row.createdAt, 80), answers };
  });
}

function failure(status: number): Error {
  if (status === 401) return new RepliesHttpError(status, "Sign in to access your replies.");
  if (status === 404) return new RepliesHttpError(status, "Collect replies is unavailable here right now.");
  if (status === 429) return new RepliesHttpError(status, "Replies are busy. Try again shortly.");
  if (status === 503) return new RepliesHttpError(status, "Collect replies is unavailable here right now.");
  return new RepliesHttpError(status, "Couldn’t complete this replies action. Try again.");
}

/** Owner requests use the current account, or the local beta's browser session. */
export function createRepliesClient(options: Options = {}) {
  const origin = options.origin ?? location.origin;
  const send = options.fetch ?? fetch;
  const request = async (path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> => {
    signal?.throwIfAborted();
    const controller = new AbortController();
    let stop!: (reason: unknown) => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      stop = reason => { controller.abort(reason); reject(reason); };
    });
    const cancel = () => stop(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => stop(new Error("Replies timed out.")), options.timeoutMs ?? 30000);
    try {
      const response = await Promise.race([stopped, send(new URL(path, origin).href, {
        ...init,
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      })]);
      if (!response.ok) throw failure(response.status);
      if (response.status === 204) return null;
      return Promise.race([stopped, response.json()]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  };
  return {
    async createBox(title: string, signal?: AbortSignal): Promise<ReplyBox> {
      const result = await request("/api/reply-boxes", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
      }, signal);
      return box(result, origin, false);
    },
    async listBoxes(signal?: AbortSignal): Promise<ReplyBox[]> {
      const rows = object(await request("/api/reply-boxes", { method: "GET" }, signal)).boxes;
      if (!Array.isArray(rows) || rows.length > 1000) throw new Error("Invalid replies response.");
      return rows.map(row => box(row, origin, true));
    },
    async listReplies(id: string, signal?: AbortSignal): Promise<CollectedReply[]> {
      return replies(await request(`/api/reply-boxes/${encodeURIComponent(identifier(id))}/replies`, { method: "GET" }, signal));
    },
    async deleteBox(id: string, signal?: AbortSignal): Promise<void> {
      await request(`/api/reply-boxes/${encodeURIComponent(identifier(id))}`, { method: "DELETE" }, signal);
    },
  };
}

export type RepliesClient = ReturnType<typeof createRepliesClient>;
