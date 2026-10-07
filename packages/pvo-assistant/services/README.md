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

- `runtime` retains the exact `nodejs-esm` descriptor: Node version, digest-pinned base image, runner digest and final image digest. Every field must match the one supported runtime; superseded Worker packages are rejected.
- Files are `{path, content}` with relative lowercase ASCII `.mjs` paths under `src/` or `tests/`. Source bytes are preserved. Absolute paths, traversal, hidden files, duplicate names and symlink metadata are rejected. The filesystem adapter must also enforce symlink containment when materializing/reading files.
- `entrypoint` names an existing `src/` file exporting `execute({operation, input, state, now})`, synchronously or asynchronously returning `{result, state}`. Parsing does not load or validate executable JavaScript. Module/linkage and execution failures are test-runner responsibilities.
- `dependencies` retains complete reviewed library bytes and exact version/registry integrity. `resolveNodeLibraries()` resolves only IDs from the platform catalog (`nanoid@5.1.6` initially); altered bytes, unknown versions, install scripts and arbitrary package downloads are rejected. An empty selection is valid. Node built-ins and relative source modules are available inside the execution sandbox.
- `tests` names one to eight existing `tests/*.test.mjs` modules (subdirectories allowed). Generated tests are useful feedback; they never replace the saved behavior cases or trusted platform checks.

`parseServiceInvocation` checks the operation, input, current state and trusted Unix-millisecond timestamp. `parseServiceReply` checks the result, proposed state and read-only rule. The host supplies the actual state/time, performs audience authorization and later commits writes atomically. Passing a schema check grants no ownership, session, storage or network capability. A caller-supplied creator label cannot authorize an operation.

Canonical package bytes are produced by `serializeServicePackage`. An adapter owns their SHA-256 and storage receipt; generated files cannot supply a readiness flag or hosted address. Changing source whitespace changes the content identifier. Array/file order is preserved and contributes to that identifier.

## Fixed bounds

`SERVICE_PACKAGE_LIMITS` is the source of truth: eight operations; 16 cases; eight steps/case and 64 steps total; 256 schema nodes across the entire agreement; depth eight (root zero); 24 object fields; 128 array items; 8 KiB/string, input or result; 48 KiB/state; 64 KiB/invocation or reply; 256 KiB/agreement; 32 files; 128 KiB/file; 1 MiB/package; eight generated test modules. Serialized-envelope limits include JSON escaping. Numeric bounds are finite and inside JavaScript's safe numeric range. These are product package limits; the separate 1B inactive diagnostic retains its smaller probe limits.

No static copy or publication-list change is needed until an application consumes this entry point. This package is currently private repository source, like the saved-task contract.


## Independent test reports

`testing.js` validates ordered case results and the `restyle-service-checks-v1` report. Every report binds the exact agreement, package and source SHA-256 digests. A missing, failed or interrupted case cannot pass. `inspectServiceReply` compares actual output and proposed state with the saved examples and enforces the input/output schema and read-only rule. Diagnostics are bounded; reports contain at most 48 KiB. Parsing a report never grants authority to submit it.

`server/assistant/validation/` owns immutable task packages and reports in the authenticated owner's SQLite coordinator. It captures only the owned snapshot requested for review, hashes its actual bytes and the immutable agreement, and constructs a canonical package. The capture receipt identifies its saved package digest and byte count. Every reviewed package and its report are retained for the unfinished goal; private source and reports expire after Ready/Stop starts seven-day task retention.

The trusted runner and hosted service use the same immutable Node artifact through the existing durable execution controller and private Fly Machine adapter. Expected answers, generated tests, credentials and comparison/report authority stay outside the guest. Each call receives fresh sandbox state; saved application records stay in the existing service authority. Execution has a two-second outside deadline and 64 KiB input/reply bounds; readiness and checked upload are separately bounded. A validation step allows 310 seconds within a 330-second claim to include preparation and confirmed cleanup. Guest isolation and resource evidence are in the [Node provider proof](../../../docs/engineering/restyle-node-provider-proof.md). Module/syntax failures, malformed output, read-only state changes, excess output and guest timeouts fail the case; provider uncertainty is not a source-code failure.

Each capture or isolated test step reserves one accounted task tool call before dispatch. The checked step state, report prefix, receipt, usage settlement and next checkpoint commit together. Completed steps survive restart without replay. A lost isolated step is charged as interrupted and may be retried with a new operation ID; it has no live data or external effects. Stop rejects late artifacts and reports. A test failure returns trusted feedback for repair without changing the agreement. There is no fixed goal-wide model, tool or review-attempt count. Passing tests advances to separate hosting work; it does not produce a live address or ready component.

Local verification includes actual isolated workerd execution and durable restart tests with controlled model/workspace adapters. Production CPU enforcement and full live natural-language generation/hosting acceptance remain separate provider evidence and Roadmap 1F work.

`parseServiceState(agreement, value)` validates retained records against a checked version's data schema and state byte bound without executing code or changing records. Hosted activation/update/rollback uses this public boundary; a new version's initial state is never a migration or a replacement for live records.

## Saved Container drafts (1G.02)

A `ServiceDraft` shares the hosted service's owner/project/service identity and adds a revision, update time and editable content. `parseServiceDraftContent` accepts bounded unfinished `.mjs` source, an optional behavior agreement, entry point and selected tests. Saving does not compile, run code, start a workshop, change live records or publish a release. Its dependency selection uses the same exact supported bytes as a checked release. Manual and AI writes use the same revision-checked draft command.

Authenticated `POST /api/services` creates a draft using an owned project, description and stable `actionId`. `GET /api/services/:serviceId/draft` reads it; `POST` saves `{actionId, expectedRevision, content}`. The host commits draft and bounded receipt atomically. Identical retry returns the original committed revision and the current draft; changed input with that ID or a stale revision conflicts. Wrong owners cannot read source. First generated publication initializes the draft, while later publications preserve manual edits.

The editor retains account/service-scoped pending edits and exact save commands before network effects. Conflicts keep local edits until the creator explicitly chooses a version. Drafts survive task and inactive-release cleanup; explicit service deletion removes drafts and prevents stale saves. Independent execution and release validation remain separate gates. See [the Container contract](../../../docs/engineering/restyle-containers-contract.md).

AI continuation uses the same save command with an additional private, short-lived task grant. There is no separate AI draft or service registry. Its pending command, saved questions, bounded file reads and interrupted-work recovery belong to the [existing task runner](../tasks/README.md#container-editing-context-1g03). Editing and testing do not activate a release.


Hosted execution capacity or allowance saves a task wait with its retry time. The partial case and exact artifact remain unchanged; no repair inference runs merely because capacity is unavailable. Stop fences both waiting and in-flight validation. Startup/transport failures do not become false evidence of a source-code failure. The Node execution adapter is under `server/cloud-services/node/`; library admission is in `services/nodeBundle.js`. The isolated Fly proof is complete. Product configuration and full editor/player Node beta acceptance are separate gates; source integration alone does not establish live availability.
