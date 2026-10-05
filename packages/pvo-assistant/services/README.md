# Generated service agreement and source package

This is the pure contract for roadmap **1C.01/1C.07/1C.08**. Public imports use `index.js` / `index.d.ts`. It does not execute code, grant access, save a task, hash content, or assert that a test passed. Workspace, independent test-runner, storage and hosting adapters own those effects.

## In plain language

The agent first writes down what the service must do and examples of correct results. Restyle saves that agreement before the agent writes the program. The code is delivered as a separate package referring to that exact agreement. Changing the program cannot silently change its target tests.

A service can have different actions, such as joining a dinner, reserving equipment or reading a creator's records. The platform uses one general contract; those examples are test fixtures, not built-in feature templates.

## Behavior agreement

`ServiceAgreement` contains a description, a state description and initial value, named operations, and ordered behavior cases. Each operation declares its description, `public` or `creator` audience, `read` or `write` access, input description and result description. Each case has an ID, description, initial state, and steps containing `operation`, `input`, `now` and the exact expected `{result, state}`.

Every operation must appear in at least one case. Each case starts with its own state; subsequent steps use the prior expected state. All examples must satisfy the same data rules used for real calls. Read operations must leave state unchanged. This structural validation does **not** prove the examples express the request correctly or prove a program passes them. The planner must derive them from the request and saved answers; the trusted runner compares actual execution with the saved examples.

`serializeServiceAgreement` returns canonical JSON with sorted object keys and unchanged array ordering. An adapter computes SHA-256 over its UTF-8 bytes and saves the agreement and digest outside generated files before generation. That trusted saved digest is supplied to `matchServicePackage`; the model's copy is not authority. Persisted immutability and trusted test evidence are implemented by 1C.05/1C.07/1C.08.

## Data descriptions

This small closed language is not general JSON Schema. Every object field is required; unknown fields are rejected. Use empty strings/arrays or an explicit enum value when the agreed domain needs an empty value. The initial contract has no optional properties, references, regular-expression validators, arbitrary code, or implicit conversions.

| Description | Accepted values |
| --- | --- |
| `{type: "null"}` | JSON null |
| `{type: "boolean"}` | Boolean |
| `{type: "string", maxBytes}` | String, including empty, within the UTF-8 byte bound |
| `{type: "number", minimum, maximum}` | Finite number within inclusive safe-range bounds |
| `{type: "integer", minimum, maximum}` | Safe integer within inclusive bounds |
| `{type: "enum", values}` | One of up to 32 unique nonblank strings |
| `{type: "array", maxItems, items}` | Bounded array whose entries match `items` |
| `{type: "object", fields}` | Closed object; fields are `{name, description, schema}` |

Names start with a lowercase ASCII letter and contain at most 64 letters, numbers or underscores. Prototype-related names are excluded. Parsers reject non-finite numbers, sparse arrays, accessors, unsupported keys/symbols, non-plain objects, excessive nesting and oversized values. They return independent clones and do not coerce data.

## Program and invocation

`ServicePackage` contains `agreementDigest`, `runtime`, `entrypoint`, `dependencies`, `files` and `tests`:

- Runtime is exactly `cloudflare-workers-esm`: JavaScript ESM targeting the isolated Workers environment. It is not Node.js production hosting.
- Files are `{path, content}` with relative lowercase ASCII `.mjs` paths under `src/` or `tests/`. Source bytes are preserved. Absolute paths, traversal, hidden files, duplicate names and symlink metadata are rejected. The filesystem adapter must also enforce symlink containment when materializing/reading files.
- `entrypoint` names an existing `src/` file exporting `execute({operation, input, state, now})`, synchronously or asynchronously returning `{result, state}`. Parsing does not load or validate executable JavaScript. Module/linkage and execution failures are test-runner responsibilities.
- `dependencies` is an explicit **empty lock (`[]`)** for this first runtime target. No external dependency or installation script is admitted. Source can use standard runtime APIs and relative modules; generated Node tests may use built-in `node:test` / `node:assert`. A future package adapter must implement exact resolution, integrity and controlled downloads before this contract admits dependencies.
- `tests` names one to eight existing `tests/*.test.mjs` modules (subdirectories allowed). Generated tests are useful feedback; they never replace the saved behavior cases or trusted platform checks.

`parseServiceInvocation` checks the operation, input, current state and trusted Unix-millisecond timestamp. `parseServiceReply` checks the result, proposed state and read-only rule. The host supplies the actual state/time, performs audience authorization and later commits writes atomically. Passing a schema check grants no ownership, session, storage or network capability. A caller-supplied creator label cannot authorize an operation.

Canonical package bytes are produced by `serializeServicePackage`. An adapter owns their SHA-256 and storage receipt; generated files cannot supply a readiness flag or hosted address. Changing source whitespace changes the content identifier. Array/file order is preserved and contributes to that identifier.

## Fixed bounds

`SERVICE_PACKAGE_LIMITS` is the source of truth: eight operations; 16 cases; eight steps/case and 64 steps total; 256 schema nodes across the entire agreement; depth eight (root zero); 24 object fields; 128 array items; 8 KiB/string, input or result; 48 KiB/state; 64 KiB/invocation or reply; 256 KiB/agreement; 32 files; 128 KiB/file; 1 MiB/package; eight generated test modules. Serialized-envelope limits include JSON escaping. Numeric bounds are finite and inside JavaScript's safe numeric range. These are product package limits; the separate 1B inactive diagnostic retains its smaller probe limits.

No static copy or publication-list change is needed until an application consumes this entry point. This package is currently private repository source, like the saved-task contract.


## Independent test reports

`testing.js` validates ordered case results and the `restyle-service-checks-v1` report. Every report binds the exact agreement, package and source SHA-256 digests. A missing, failed or interrupted case cannot pass. `inspectServiceReply` compares actual output and proposed state with the saved examples and enforces the input/output schema and read-only rule. Diagnostics are bounded; reports contain at most 48 KiB. Parsing a report never grants authority to submit it.

`server/assistant/validation/` owns immutable task packages and reports in the authenticated owner's SQLite coordinator. It captures only the owned snapshot requested for review, hashes its actual bytes and the immutable agreement, and constructs a canonical package. The capture receipt identifies its saved package digest and byte count. At most four packages are retained per task; private source and reports expire with the seven-day task retention.

The trusted runner uses fresh Dynamic Workers with explicit source modules, an empty environment, disabled outbound HTTP/TCP, zero subrequests and a 50 ms CPU limit. Only the invocation enters generated code; expected values, generated test files and comparison/report authority stay outside. Each invocation has a two-second deadline and 64 KiB input/reply bounds; a case has at most eight steps and a twenty-second deadline. State is carried by the trusted runner only after a matching reply. Fresh runtimes prevent hidden globals carrying between calls. Runtime-provided APIs can exist, including some Node built-ins; these do not grant host files, bindings or Internet access. Module load/syntax failures, malformed output, changed read-only state, excess output and timeout all fail the case.

Each capture or case reserves one of the existing 24 task tool calls before dispatch. The report prefix, receipt, usage settlement and next checkpoint commit together. Completed cases survive restart without replay. A lost isolated case is charged as interrupted and may be retried with a new operation ID under the existing three-retry limit; it has no live data or external effects. Stop rejects late artifacts and reports. A test failure returns trusted feedback for repair without changing the agreement or increasing the six-model-turn limit. Passing tests advances to separate hosting work; it does not produce a live address or ready component.

Local verification includes actual isolated workerd execution and durable restart tests with controlled model/workspace adapters. Production CPU enforcement and full live natural-language generation/hosting acceptance remain separate provider evidence and Roadmap 1F work.
