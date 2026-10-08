import {
  parseConnectionSetup,
  parseConnectionInvocation,
} from "../../../packages/pvo-assistant/connections/index.js";
import { HttpError } from "../../http.js";

const API = "https://api.github.com";
const MAX_BYTES = 256 * 1024;
export class GitHubAccessError extends HttpError {
  constructor() {
    super(
      409,
      "GitHub access has expired or changed. Reconnect this repository.",
    );
  }
}

function beforeDeadline(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("Provider deadline"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          void value?.body?.cancel().catch(() => {});
          reject(new Error("Provider deadline"));
        } else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/** Exact host, fixed GET operations, no redirects or caller-supplied headers. */
export function githubAdapter(fetcher = fetch, timeoutMs = 10000) {
  async function read(path, token) {
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await beforeDeadline(
        fetcher(`${API}${path}`, {
          method: "GET",
          redirect: "manual",
          signal,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "Restyle-account-connections",
          },
        }),
        signal,
      );
    } catch {
      throw new HttpError(
        503,
        "GitHub could not be reached. Retry this read later.",
      );
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      if (
        response.status === 429 ||
        response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after")
      )
        throw new HttpError(
          429,
          "GitHub is limiting requests. Try again later.",
        );
      if ([401, 403, 404].includes(response.status))
        throw new GitHubAccessError();
      throw new HttpError(
        503,
        "GitHub did not return a usable response. Recheck the repository and retry.",
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new HttpError(503, "GitHub returned an empty response.");
    let size = 0,
      chunks = [];
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await beforeDeadline(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("Response limit");
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const raw = new TextDecoder().decode(bytes);
      if (raw.includes(token)) throw new Error("Reflected credential");
      const value = JSON.parse(raw);
      if (JSON.stringify(value).includes(token))
        throw new Error("Reflected credential");
      const expiry = Date.parse(
        response.headers.get("github-authentication-token-expiration") ?? "",
      );
      return { value, expiresAt: Number.isFinite(expiry) ? expiry : null };
    } catch {
      throw new HttpError(
        503,
        "GitHub returned data that Restyle could not safely read.",
      );
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const route = (scope) =>
    `/repos/${parseConnectionSetup(scope).repository.split("/").map(encodeURIComponent).join("/")}`;
  function repo(value, scope) {
    if (
      typeof value?.full_name !== "string" ||
      value.full_name.toLowerCase() !== scope.repository ||
      typeof value.private !== "boolean" ||
      !Number.isSafeInteger(value.open_issues_count) ||
      value.open_issues_count < 0
    )
      throw new HttpError(
        503,
        "GitHub returned a different repository. Reconnect with its current name.",
      );
    return {
      repository: scope.repository,
      private: value.private,
      openIssues: value.open_issues_count,
    };
  }
  function issues(value) {
    if (!Array.isArray(value) || value.length > 20)
      throw new HttpError(503, "GitHub returned an invalid issue page.");
    return {
      items: value
        .filter((item) => !item.pull_request)
        .map((item) => {
          if (
            !Number.isSafeInteger(item.number) ||
            typeof item.title !== "string" ||
            item.title.length > 1024 ||
            !["open", "closed"].includes(item.state)
          )
            throw new HttpError(503, "GitHub returned an invalid issue.");
          return { number: item.number, title: item.title, state: item.state };
        }),
      more: value.length === 20,
    };
  }
  return {
    async verify(scope, token) {
      scope = parseConnectionSetup(scope);
      const identity = await read("/user", token);
      if (
        !Number.isSafeInteger(identity.value?.id) ||
        !/^[A-Za-z0-9-]{1,39}$/.test(identity.value?.login ?? "")
      )
        throw new HttpError(503, "GitHub did not confirm an account.");
      const repository = await read(route(scope), token);
      repo(repository.value, scope);
      issues(
        (
          await read(
            `${route(scope)}/issues?state=all&per_page=20&page=1`,
            token,
          )
        ).value,
      );
      return {
        accountId: identity.value.id,
        login: identity.value.login,
        expiresAt: identity.expiresAt,
        scope,
      };
    },
    async invoke(scope, token, input) {
      scope = parseConnectionSetup(scope);
      const call = parseConnectionInvocation(input);
      const result = await read(
        call.operation === "github_repository_read"
          ? route(scope)
          : `${route(scope)}/issues?state=all&per_page=20&page=${call.input.page}`,
        token,
      );
      return call.operation === "github_repository_read"
        ? repo(result.value, scope)
        : issues(result.value);
    },
  };
}
