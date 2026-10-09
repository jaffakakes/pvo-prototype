import { githubAdapter } from "./github.js";
import { resendAdapter } from "./resend.js";
import { agentIdentityAdapter } from "./agentIdentity.js";

/** Authentication stays in reviewed adapters; selecting a provider never grants a generated URL. */
export function installedConnectionProvider(fetcher = fetch) {
  const providers = {
    github: githubAdapter(fetcher),
    resend: resendAdapter(fetcher),
    agentmail: agentIdentityAdapter("agentmail", fetcher),
    agentphone: agentIdentityAdapter("agentphone", fetcher),
  };
  function provider(scope) {
    const result = providers[scope.provider];
    if (!result) throw new Error("No installed account adapter.");
    return result;
  }
  return {
    verify: (scope, token) => provider(scope).verify(scope, token),
    invoke: (scope, token, input) =>
      provider(scope).invoke(scope, token, input),
    service: {
      invoke: (scope, ...args) =>
        provider(scope).service.invoke(scope, ...args),
      inspect: (scope, ...args) =>
        provider(scope).service.inspect(scope, ...args),
      status: (scope, ...args) =>
        provider(scope).service.status(scope, ...args),
    },
  };
}
