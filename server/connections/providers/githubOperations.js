import {
  parseConnectionAdapter,
  parseAdapterInput,
  adapterPolicy,
  projectAdapterResult,
} from "../../../packages/pvo-assistant/connections/index.js";
import { githubTransport } from "./githubTransport.js";

function requestPath(scope, adapter, input) {
  const segment = (part) => {
    const value = typeof part === "string" ? part : String(input[part.input]);
    if (!/^[A-Za-z0-9 _.-]{1,140}$/.test(value) || [".", ".."].includes(value))
      throw new Error("Unsafe provider path value.");
    return encodeURIComponent(value);
  };
  const base = `/repos/${scope.repository.split("/").map(segment).join("/")}`;
  const suffix = adapter.path.map(segment).join("/");
  const query = new URLSearchParams();
  for (const item of adapter.query) {
    const value =
      typeof item.value === "string"
        ? item.value
        : String(input[item.value.input]);
    if (
      (item.name === "page" &&
        (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1000)) ||
      (item.name === "per_page" &&
        (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 20)) ||
      (item.name === "state" && !["open", "closed", "all"].includes(value)) ||
      (item.name === "sort" &&
        !["created", "updated", "comments"].includes(value)) ||
      (item.name === "direction" && !["asc", "desc"].includes(value))
    )
      throw new Error("Provider query exceeds its installed policy.");
    query.set(item.name, value);
  }
  if (
    adapter.method === "GET" &&
    adapter.path.length === 1 &&
    !query.has("per_page")
  )
    query.set("per_page", "20");
  return base + (suffix ? `/${suffix}` : "") + (query.size ? `?${query}` : "");
}

/** Generated recipes use reviewed authentication, repository scope and request policy only. */
export function githubOperationAdapter(fetcher = fetch, timeoutMs = 10000) {
  const request = githubTransport(fetcher, timeoutMs);
  const prepared = (scope, raw, value) => {
    const adapter = parseConnectionAdapter(raw),
      input = parseAdapterInput(adapter, value);
    return {
      adapter,
      input,
      path: requestPath(scope, adapter, input),
      policy: adapterPolicy(adapter),
    };
  };
  return {
    async invoke(scope, token, raw, value, receiptKey) {
      const { adapter, input, path, policy } = prepared(scope, raw, value);
      let options;
      if (policy.effect === "write") {
        if (!/^[a-f0-9]{64}$/.test(receiptKey ?? ""))
          throw new Error("Missing durable request identity.");
        options = {
          method: "POST",
          body: {
            title: input.title,
            body: `${input.body}\n\n<!-- restyle-request:${receiptKey} -->`,
          },
        };
      }
      const response = await request(path, token, options);
      return projectAdapterResult(adapter, response.value);
    },
    async inspect(scope, token, raw, value, receiptKey, account) {
      const { adapter, input, policy } = prepared(scope, raw, value);
      if (
        policy.recovery !== "github_issue_marker" ||
        !/^[a-f0-9]{64}$/.test(receiptKey ?? "")
      )
        return null;
      const path = `/repos/${scope.repository.split("/").map(encodeURIComponent).join("/")}/issues?state=all&sort=created&direction=desc&per_page=20&creator=${encodeURIComponent(account)}`;
      const { value: entries } = await request(path, token);
      if (!Array.isArray(entries) || entries.length > 20)
        throw new Error("Invalid inspection result.");
      const body = `${input.body}\n\n<!-- restyle-request:${receiptKey} -->`;
      const matches = entries.filter(
        (item) =>
          !item.pull_request &&
          item.user?.login === account &&
          item.title === input.title &&
          item.body === body,
      );
      // A bounded page with no match is never proof that the original write failed.
      return matches.length === 1
        ? projectAdapterResult(adapter, matches[0])
        : null;
    },
  };
}
