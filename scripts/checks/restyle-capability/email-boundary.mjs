import assert from "node:assert/strict";
import { executeConnectedOperation } from "../../../server/cloud-services/connectedExecution.js";
import { parseServiceReply } from "../../../packages/pvo-assistant/services/index.js";

/** Supplement the fixed email journey with legal maximum-length provider replies. */
export async function checkEmailReceiptBounds(agreement, execute, record) {
  const binding = agreement.connections.find(
    (item) => item.adapter.provider === "agentmail",
  );
  assert.ok(binding, "The fixed email journey needs its AgentMail binding.");
  const operation = agreement.operations.find(
    (item) => item.access === "write" && binding.operations.includes(item.name),
  );
  assert.ok(operation);
  assert.ok(
    operation.input.type === "null" ||
      (operation.input.type === "object" &&
        operation.input.fields.length === 0),
    "The fixed email button must not require viewer input.",
  );
  for (const id of ["r".repeat(512), "🧾".repeat(128)]) {
    const invocation = {
      operation: operation.name,
      input: operation.input.type === "null" ? null : {},
      state: agreement.state.initial,
      now: 0,
    };
    const result = {
      receiptBytes: Buffer.byteLength(id),
      unicode: id.startsWith("🧾"),
      requests: 0,
    };
    try {
      const reply = await executeConnectedOperation({
        agreement,
        invocation,
        execute,
        invoke: async (request) => {
          result.requests++;
          assert.deepEqual(request, {
            connection: binding.name,
            input: { subject: "Thanks", text: "Thanks for watching" },
          });
          return { id };
        },
        signal: AbortSignal.timeout(30000),
      });
      parseServiceReply(agreement, invocation, reply);
      assert.equal(result.requests, 1);
      assert.ok(
        JSON.stringify(reply.result).includes(id),
        "The entire actual receipt must survive the continuation.",
      );
      result.passed = true;
    } catch (error) {
      result.passed = false;
      result.error = error.message;
      await record(result);
      throw error;
    }
    await record(result);
  }
}
