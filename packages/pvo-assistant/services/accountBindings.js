import { object, list, id, unique, requireTask } from "../tasks/validation.js";
import { serviceName, boundedValue } from "./values.js";
import { canonicalJson } from "./json.js";
import {
  parseConnectionAdapter,
  parseAdapterInput,
  adapterPolicy,
  ADAPTER_LIMITS,
} from "../connections/adapters.js";

/** Optional account capabilities are part of the one current immutable agreement. */
export function validateAccountBindings(agreement) {
  if (!Object.hasOwn(agreement, "connections")) return;
  list(agreement.connections, ADAPTER_LIMITS.bindings, "Account bindings");
  requireTask(
    agreement.connections.length > 0,
    "Omit connections when no account is needed.",
  );
  for (const binding of agreement.connections) {
    object(
      binding,
      ["name", "connectionId", "operations", "adapter", "examples"],
      "Account binding",
    );
    serviceName(binding.name, "Binding name");
    id(binding.connectionId, "Private connection reference");
    list(
      binding.operations,
      agreement.operations.length,
      "Permitted service operations",
    );
    requireTask(
      binding.operations.length > 0,
      "A binding needs an agreed service operation.",
    );
    unique(binding.operations, "Binding operations");
    requireTask(
      binding.operations.every((name) =>
        agreement.operations.some((item) => item.name === name),
      ),
      "Binding names an unknown service operation.",
    );
    const adapter = parseConnectionAdapter(binding.adapter);
    requireTask(
      adapterPolicy(adapter).effect !== "write" ||
        binding.operations.every(
          (name) =>
            agreement.operations.find((item) => item.name === name).access ===
            "write",
        ),
      "An external write requires a declared write operation.",
    );
    list(binding.examples, 12, "Independent account examples");
    requireTask(
      binding.examples.length > 0,
      "A connection needs test replies before generation.",
    );
    const inputs = [];
    for (const example of binding.examples) {
      object(example, ["input", "result"], "Account example");
      parseAdapterInput(adapter, example.input);
      boundedValue(
        adapter.result,
        example.result,
        ADAPTER_LIMITS.resultBytes,
        "Example result",
      );
      inputs.push(canonicalJson(example.input));
    }
    unique(inputs, "Account example inputs");
  }
  unique(
    agreement.connections.map((item) => item.name),
    "Account binding names",
  );
}

export function parseAccountRequest(agreement, operation, value) {
  object(value, ["connection", "input"], "Generated account request");
  const binding = agreement.connections?.find(
    (item) => item.name === value.connection,
  );
  requireTask(
    binding?.operations.includes(operation),
    "This account action is not agreed for the service operation.",
  );
  parseAdapterInput(binding.adapter, value.input);
  return structuredClone(value);
}

export function validateConnectionResults(agreement, invocation) {
  if (!Object.hasOwn(invocation, "connectionResults")) return;
  list(invocation.connectionResults, ADAPTER_LIMITS.calls, "Account results");
  requireTask(
    invocation.connectionResults.length > 0,
    "Omit empty account results.",
  );
  for (const item of invocation.connectionResults) {
    object(item, ["connection", "input", "result"], "Account result");
    parseAccountRequest(agreement, invocation.operation, {
      connection: item.connection,
      input: item.input,
    });
    const binding = agreement.connections.find(
      (entry) => entry.name === item.connection,
    );
    boundedValue(
      binding.adapter.result,
      item.result,
      ADAPTER_LIMITS.resultBytes,
      "Checked account result",
    );
  }
}

export function exampleAccountResult(agreement, operation, request) {
  const call = parseAccountRequest(agreement, operation, request);
  const binding = agreement.connections.find(
    (item) => item.name === call.connection,
  );
  const example = binding.examples.find(
    (item) => canonicalJson(item.input) === canonicalJson(call.input),
  );
  requireTask(
    example,
    "This test request has no independently saved example reply.",
  );
  return structuredClone(example.result);
}
