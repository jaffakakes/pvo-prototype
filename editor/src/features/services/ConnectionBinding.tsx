import type { ServiceInputBinding } from "../../../../packages/pvo-assistant/attachments/index.js";
import type {
  ServiceJson,
  ServiceValueSchema,
} from "../../../../packages/pvo-assistant/services/index.js";
import {
  defaultInputBinding,
  matchingConnectionFields,
  type ConnectionField,
} from "../../domain/services/connectionEditing";

/** Closed, typed input mapping. Fixed arrays use JSON data; no expressions or templates execute. */
export function ConnectionBinding({
  schema,
  binding,
  fields,
  label,
  disabled,
  onChange,
}: {
  schema: ServiceValueSchema;
  binding: ServiceInputBinding;
  fields: ConnectionField[];
  label: string;
  disabled: boolean;
  onChange: (value: ServiceInputBinding) => void;
}) {
  if (schema.type === "object" && binding.kind === "object")
    return (
      <fieldset disabled={disabled}>
        <legend>{label}</legend>
        {schema.fields.map((field, index) => (
          <div key={field.name}>
            <p>{field.description}</p>
            <ConnectionBinding
              schema={field.schema}
              binding={binding.fields[index].value}
              fields={fields}
              label={`${label}.${field.name}`}
              disabled={disabled}
              onChange={(value) =>
                onChange({
                  kind: "object",
                  fields: binding.fields.map((entry, at) =>
                    at === index ? { ...entry, value } : entry,
                  ),
                })
              }
            />
          </div>
        ))}
      </fieldset>
    );
  const matching = matchingConnectionFields(schema, fields);
  const literal = (value: ServiceJson) => onChange({ kind: "literal", value });
  return (
    <div>
      {schema.type === "null" ? (
        <p>{label}: no input required.</p>
      ) : (
        <>
          <label>
            Value for {label}
            <select
              disabled={disabled}
              value={
                binding.kind === "field" ? `field:${binding.name}` : "literal"
              }
              onChange={(event) =>
                event.target.value === "literal"
                  ? onChange(defaultInputBinding(schema))
                  : onChange({
                      kind: "field",
                      name: event.target.value.slice(6),
                    })
              }
            >
              {matching.map((field) => (
                <option key={field.name} value={`field:${field.name}`}>
                  Form field: {field.label}
                </option>
              ))}
              <option value="literal">Fixed value</option>
            </select>
          </label>
          {binding.kind === "literal" && (
            <label>
              Fixed value for {label}
              {schema.type === "boolean" ? (
                <select
                  disabled={disabled}
                  value={String(binding.value)}
                  onChange={(event) => literal(event.target.value === "true")}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : schema.type === "enum" ? (
                <select
                  disabled={disabled}
                  value={String(binding.value)}
                  onChange={(event) => literal(event.target.value)}
                >
                  {schema.values.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ) : schema.type === "number" || schema.type === "integer" ? (
                <input
                  disabled={disabled}
                  type="number"
                  min={schema.minimum}
                  max={schema.maximum}
                  step={schema.type === "integer" ? 1 : "any"}
                  value={
                    typeof binding.value === "number" &&
                    Number.isFinite(binding.value)
                      ? binding.value
                      : ""
                  }
                  onChange={(event) => literal(event.target.valueAsNumber)}
                />
              ) : schema.type === "array" ? (
                <textarea
                  disabled={disabled}
                  value={
                    typeof binding.value === "string"
                      ? binding.value
                      : JSON.stringify(binding.value, null, 2)
                  }
                  onChange={(event) => {
                    try {
                      literal(JSON.parse(event.target.value) as ServiceJson);
                    } catch {
                      literal(event.target.value);
                    }
                  }}
                  placeholder="[]"
                />
              ) : (
                <input
                  disabled={disabled}
                  value={String(binding.value ?? "")}
                  onChange={(event) => literal(event.target.value)}
                />
              )}
            </label>
          )}
          {schema.type === "array" && (
            <p>
              Enter a fixed JSON list. Restyle checks each value against this
              operation’s input rules.
            </p>
          )}
        </>
      )}
    </div>
  );
}
