import { parseServicePackage } from "../../packages/pvo-assistant/services/index.js";
import { executeNodeBundle } from "./node/client.js";

/** The checked artifact is the hosted artifact. Only trusted callers supply ownership and mode. */
export function executeServicePackage(
  namespace,
  value,
  invocation,
  scope,
  signal,
) {
  const source = parseServicePackage(value);
  return executeNodeBundle(
    namespace,
    {
      entrypoint: source.entrypoint,
      files: source.files,
      dependencies: source.dependencies,
    },
    invocation,
    scope,
    signal,
  );
}
