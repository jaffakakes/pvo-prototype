# 1E: connect checked services to components

[Numbered roadmap](01-first-working-component.md#1e-attach-the-service-to-pvo-and-activate-it) · [Progress and evidence](../restyle-cloud-agent-progress.md)

## In everyday terms

The cloud agent has built a small service and tested its rules. This stage gives the component a checked connection to that service. Restyle must make sure it is the right service, belongs to the right creator and project, and accepts the information the component will send.

The AI suggests the connection. Restyle reads its own saved test result and asks the actual hosting system whether that exact release still exists. The AI cannot grant itself permission by writing an address or saying “ready.” Testing a component and making it available to viewers remain separate actions.

## Build order

| Task | Deliverable | Verification |
| --- | --- | --- |
| 1E.01 | Closed attachment proposal plus trusted service receipt; owner/project/task/release/operation binding and bounded typed input mapping | Reject invented URLs/readiness, mismatched identities, private operations, expired/missing releases; verify actual hosted lookup, restart and Stop fencing |
| 1E.02 | Server and editor admit only the exact verified attachment | Keep ordinary assistant request protections; reject extra or changed unrelated requests, wrong controls and missing/type-mismatched form fields |
| 1E.03 | Produce component, checked request and connection metadata together using existing compiler/history commands | Atomic apply/Undo/Redo, compiler failure rollback, project fingerprint/account change, approved host and visible request failures |
| 1E.04 | Shared action identity and retry rules for Try/player | Lost-response retry reuses action ID and input; separate submission receives a new ID |
| 1E.05 | Server-authorized Try connection | Only owner/test route; changing payload cannot select live records or private permissions |
| 1E.06–08 | Shared activation before link or download delivery; persist uncertain delivery | Activation failure blocks readiness; delivery retry recovers same release without reset or duplicate actions |
| 1E.09 | Cross-origin downloaded PVO acceptance | Supported separate player writes live records without creator cookie |

## Current contract

`packages/pvo-assistant/attachments/` owns the pure contract. A `service.attach` command contains one complete `component.add` or `component.source` proposal and a connection identifying a release, operation, component event/target and typed input bindings. Bindings are literal values, form fields, objects or arrays; they are data and cannot execute code. A form binding's actual existence/type is checked against compiler output in 1E.02. Runtime values still need service input validation.

The command contains no service URL, credential, receipt or readiness flag. Ordinary native assistant parsing does not admit `service.attach`. Server and editor integration must use the separate verified path; do not add a general “allow requests” option.

A receipt contains the exact owned release identity and its four digests, one public operation's input/result description, and observed hosting state/time. It excludes generated source, private initial state, behavior examples and creator operations. Parsing a receipt validates its shape; it does **not** prove provenance. The trusted server resolver selects task-owned passed artifacts and the completed provider journal entry, rehashes their bytes, calls the actual provider and checks the task claim again after waiting. The editor will obtain evidence through the authenticated immutable saved-result transport, with current project/account checks. No model-supplied receipt is accepted as authority.

Inactive readiness expires with the release. Retained readiness means a host retained the release; it is not a promise of future availability or permission to activate. Activation and invocation must still validate current host state. Resolving an attachment neither activates a service nor marks the saved component result ready.

## Checkpoint

**1E.01 is verified.** Full local checks pass **1,352 tests**, including six new contract/actual local workerd tests, syntax/dependency/format checks and public declarations. See progress for logs and exact branch/checkpoint. **1E.02 remains unchecked.** The next implementation is narrow compiler admission, followed by component/history/runtime wiring. No complete end-to-end component or cloud product availability is claimed.
