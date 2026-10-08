import { executeConnectedOperation } from "./connectedExecution.js";
import {
  parseServiceInvocation,
  parseServiceReply,
} from "../../packages/pvo-assistant/services/index.js";
import { parseInactiveProbe } from "../../packages/pvo-assistant/releases/index.js";
import { executeServicePackage } from "./packageExecution.js";

/** Private creator test: its state/time are supplied here, with no path to live records or permissions. */
export async function probeInactiveService(
  namespace,
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
  const reply = await executeConnectedOperation({
    agreement,
    invocation,
    signal,
    execute: (input, current) =>
      executeServicePackage(
        namespace,
        publication.artifact.package,
        input,
        {
          ownerId: publication.identity.ownerId,
          serviceId: publication.identity.serviceId,
          mode: "probe",
        },
        current,
      ),
  });
  const checked = parseServiceReply(agreement, invocation, reply);
  return { status: 200, body: JSON.stringify(checked) };
}
