import {
  parseServiceInvocation,
  parseServiceReply,
} from "../../packages/pvo-assistant/services/index.js";
import { parseInactiveProbe } from "../../packages/pvo-assistant/releases/index.js";
import { executeServicePackage } from "./packageExecution.js";

/** Private creator test: its state/time are supplied here, with no path to live records or permissions. */
export async function probeInactiveService(
  loader,
  publication,
  value,
  now,
  signal,
) {
  const probe = parseInactiveProbe(value),
    agreement = publication.artifact.agreement;
  const invocation = parseServiceInvocation(agreement, {
    operation: probe.operation,
    input: probe.input,
    state: agreement.state.initial,
    now,
  });
  const reply = await executeServicePackage(
    loader,
    publication.artifact.package,
    invocation,
    signal,
  );
  const checked = parseServiceReply(agreement, invocation, reply);
  return { status: 200, body: JSON.stringify(checked) };
}
