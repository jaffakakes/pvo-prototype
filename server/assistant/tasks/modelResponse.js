import { AuthoringRepairError } from "./repairFeedback.js";

/** A cut-off decision needs saved repair, not a provider-outage retry of the same prompt. */
export async function generateAuthoringResponse(models, request, signal) {
  try {
    return await models.generate(
      { ...request, purpose: "saved_authoring" },
      signal,
    );
  } catch (error) {
    if (error?.code !== "model_output_truncated") throw error;
    throw new AuthoringRepairError(
      "authoring_output_truncated",
      "The previous output was cut off before a complete decision was returned. No part ran, and there is no usable proposal to retrieve. Recreate the decision from the current saved state using compact JSON and concise descriptions. Preserve the requested behavior and all required fields/cases. For source, use the smallest complete implementation and tests; do not repeat successful prior work or return a partial file.",
      "",
    );
  }
}
