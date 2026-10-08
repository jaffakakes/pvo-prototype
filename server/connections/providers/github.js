import { githubOperationAdapter } from "./githubOperations.js";
import {
  parseConnectionSetup,
  parseConnectionInvocation,
} from "../../../packages/pvo-assistant/connections/index.js";
import { HttpError } from "../../http.js";

import { githubTransport } from "./githubTransport.js";
export { ConnectionAccessError } from "../accessError.js";

/** Account verification and the initial installed read operations. */
export function githubAdapter(fetcher = fetch, timeoutMs = 10000) {
  const read = githubTransport(fetcher, timeoutMs);
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
    service: githubOperationAdapter(fetcher, timeoutMs),
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
