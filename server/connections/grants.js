import { GITHUB_OPERATIONS } from "../../packages/pvo-assistant/connections/index.js";

/** Installed access metadata: possessing a bootstrap key grants no arbitrary provider action. */
export function connectionGrant(scope, login) {
  if (scope.provider === "github")
    return {
      name: `GitHub · ${scope.repository}`,
      permissions: [
        "repository:read",
        "issues:read",
        ...(scope.access === "issues_write" ? ["issues:write"] : []),
      ],
      operations: structuredClone(GITHUB_OPERATIONS),
    };
  if (scope.provider === "resend")
    return {
      name: `Email · ${scope.from}`,
      permissions: ["email:send"],
      operations: [],
    };
  if (["agentmail", "agentphone"].includes(scope.provider))
    return {
      name: `${scope.provider === "agentmail" ? "Agent email" : "Agent phone"} · ${login}`,
      permissions: ["identity:receive"],
      operations: [],
    };
  throw new Error("No installed account grant.");
}
