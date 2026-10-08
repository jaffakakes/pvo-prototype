import {
  object,
  text,
  list,
  unique,
  choice,
  requireTask,
} from "../tasks/validation.js";
import {
  validateSchema,
  boundedValue,
  serviceName,
} from "../services/values.js";

export const ADAPTER_LIMITS = Object.freeze({
  bindings: 4,
  calls: 4,
  inputBytes: 8192,
  resultBytes: 16384,
});
const permissions = [
  "repository:read",
  "issues:read",
  "issues:write",
  "email:send",
];

/** Installed authentication policy, separate from a generated adapter's data transformations. */
export function adapterPolicy(adapter) {
  const path = adapter.path;
  if (adapter.provider === "resend") {
    if (adapter.method === "POST" && path.length === 1 && path[0] === "emails")
      return {
        permission: "email:send",
        effect: "write",
        recovery: "resend_idempotency",
      };
    throw new Error("This email operation is not installed.");
  }
  if (adapter.method === "GET" && path.length === 0)
    return { permission: "repository:read", effect: "read", recovery: "none" };
  const root = path[0];
  if (
    adapter.method === "GET" &&
    ["issues", "labels", "milestones"].includes(root) &&
    (path.length === 1 ||
      path.length === 2 ||
      (root === "issues" && path.length === 3 && path[2] === "comments"))
  )
    return { permission: "issues:read", effect: "read", recovery: "none" };
  if (adapter.method === "POST" && path.length === 1 && root === "issues")
    return {
      permission: "issues:write",
      effect: "write",
      recovery: "github_issue_marker",
    };
  throw new Error(
    "This destination or method needs a reviewed platform adapter.",
  );
}

/** A generated request recipe never includes authentication, arbitrary origins or headers. */
export function parseConnectionAdapter(value) {
  object(
    value,
    [
      "name",
      "description",
      "provider",
      "method",
      "path",
      "query",
      "input",
      "result",
      "responsePath",
      "permission",
      "completion",
      "documentation",
    ],
    "Connection adapter",
  );
  serviceName(value.name, "Adapter name");
  text(value.description, 1024, "Adapter description");
  choice(
    value.provider,
    ["github", "resend"],
    "Installed authentication provider",
  );
  choice(value.method, ["GET", "POST"], "Provider method");
  choice(value.completion, ["synchronous"], "Completion lifecycle");
  choice(value.permission, permissions, "Adapter permission");
  text(value.documentation, 2048, "Adapter documentation");
  requireTask(
    (value.provider === "github"
      ? /^https:\/\/docs\.github\.com\/[A-Za-z0-9_/#?=.&%+-]+$/
      : /^https:\/\/resend\.com\/docs\/[A-Za-z0-9_/#?=.&%+-]+$/
    ).test(value.documentation),
    "Cite the installed provider's official documentation.",
  );
  const budget = { nodes: 0 };
  validateSchema(value.input, budget);
  validateSchema(value.result, budget);
  requireTask(
    value.input.type === "object",
    "Adapter input must be an object.",
  );
  const fields = new Map(
    value.input.fields.map((item) => [item.name, item.schema]),
  );
  const inputReference = (part) => {
    object(part, ["input"], "Request input reference");
    requireTask(fields.has(part.input), "Request uses an undeclared input.");
    const schema = fields.get(part.input);
    requireTask(
      ["string", "enum", "integer"].includes(schema.type),
      "URL input must be bounded text or an integer.",
    );
  };
  list(value.path, 3, "Provider path");
  for (const part of value.path) {
    if (typeof part === "string") {
      requireTask(
        /^[A-Za-z0-9_-]{1,64}$/.test(part),
        "Provider path contains an unsafe segment.",
      );
    } else inputReference(part);
  }
  list(value.query, 5, "Provider query");
  for (const item of value.query) {
    object(item, ["name", "value"], "Provider query entry");
    choice(
      item.name,
      ["state", "page", "per_page", "sort", "direction"],
      "Provider query name",
    );
    if (typeof item.value === "string") text(item.value, 64, "Query literal");
    else inputReference(item.value);
  }
  unique(
    value.query.map((item) => item.name),
    "Provider query names",
  );
  list(value.responsePath, 4, "Response selection");
  for (const part of value.responsePath) {
    text(part, 64, "Response key");
    requireTask(
      /^[A-Za-z0-9_-]+$/.test(part) &&
        !["__proto__", "prototype", "constructor"].includes(part),
      "Unsafe response key.",
    );
  }
  const policy = adapterPolicy(value);
  requireTask(
    policy.permission === value.permission,
    "Requested permission does not match the operation.",
  );
  if (policy.effect === "write") {
    requireTask(
      value.query.length === 0 &&
        value.input.fields.length === 2 &&
        (value.provider === "resend"
          ? ["subject", "text"]
          : ["title", "body"]
        ).every((name) => fields.get(name)?.type === "string"),
      "The write requires exactly the installed provider's bounded text fields.",
    );
    requireTask(
      fields.get(value.provider === "resend" ? "subject" : "title").maxBytes <=
        256 &&
        fields.get(value.provider === "resend" ? "text" : "body").maxBytes <=
          4096,
      "The text fields exceed the installed write policy.",
    );
  }
  if (value.provider === "resend")
    requireTask(
      value.responsePath.length === 0 &&
        value.result.type === "object" &&
        value.result.fields.length === 1 &&
        value.result.fields[0].name === "id" &&
        value.result.fields[0].schema.type === "string" &&
        value.result.fields[0].schema.maxBytes === 36,
      "Email sends must retain the provider's exact receipt ID.",
    );
  return structuredClone(value);
}

export function parseAdapterInput(adapter, input) {
  boundedValue(
    adapter.input,
    input,
    ADAPTER_LIMITS.inputBytes,
    "Adapter input",
  );
  return structuredClone(input);
}

/** Select only declared JSON fields; raw provider headers and surplus properties never cross the boundary. */
export function projectAdapterResult(adapter, value) {
  for (const key of adapter.responsePath) {
    requireTask(
      value !== null && typeof value === "object" && Object.hasOwn(value, key),
      "Provider response selection is missing.",
    );
    value = value[key];
  }
  const project = (schema, current) => {
    if (schema.type === "object") {
      requireTask(
        current !== null &&
          typeof current === "object" &&
          !Array.isArray(current),
        "Provider object is invalid.",
      );
      return Object.fromEntries(
        schema.fields.map((field) => {
          requireTask(
            Object.hasOwn(current, field.name),
            "Provider field is missing.",
          );
          return [field.name, project(field.schema, current[field.name])];
        }),
      );
    }
    if (schema.type === "array") {
      requireTask(
        Array.isArray(current) && current.length <= schema.maxItems,
        "Provider list is invalid.",
      );
      return current.map((item) => project(schema.items, item));
    }
    return current;
  };
  const result = project(adapter.result, value);
  boundedValue(
    adapter.result,
    result,
    ADAPTER_LIMITS.resultBytes,
    "Adapter result",
  );
  return result;
}
