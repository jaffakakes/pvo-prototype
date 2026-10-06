# 1E: connect checked services to components

[Numbered roadmap](01-first-working-component.md#1e-attach-the-service-to-pvo-and-activate-it) · [Progress and evidence](../restyle-cloud-agent-progress.md)

**Next product evolution:** [1G Containers](1g-containers.md) follows 1F and reuses these service/attachment boundaries with hosted Node.js. The evidence and completion states below describe their original implementation and remain unchanged.

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

`packages/pvo-assistant/attachments/` owns the pure contract. A `service.attach` command contains one complete `component.add` or `component.source` proposal and a connection identifying a release, operation, component event/target and typed input bindings. Bindings are literal values, form fields, objects or arrays; they are data and cannot execute code. A form binding's actual existence/type is checked against compiler output at both server/editor boundaries. Runtime values still need service input validation.

The connection fields contain no service URL, credential, receipt or readiness flag. Source is untrusted until compiler policy verifies its exact approved request. Ordinary native assistant parsing does not admit `service.attach`. Server/editor native validation accepts the separate verified path; ordinary model operations cannot supply its authority. Do not add a general “allow requests” option.

A receipt contains the exact owned release identity and its four digests, one public operation's input/result description, and observed hosting state/time. It excludes generated source, private initial state, behavior examples and creator operations. Parsing a receipt validates its shape; it does **not** prove provenance. The trusted server resolver selects task-owned passed artifacts and the completed provider journal entry, rehashes their bytes, calls the actual provider and checks the task claim again after waiting. The editor will obtain evidence through the authenticated immutable saved-result transport, with current project/account checks. No model-supplied receipt is accepted as authority.

Inactive readiness expires with the release. Retained readiness means a host retained the release; it is not a promise of future availability or permission to activate. Activation and invocation must still validate current host state. Resolving an attachment neither activates a service nor marks the saved component result ready.

## Compiler admission and remaining wiring

`ServiceAttachmentAuthorization` is supplied separately from native model output and combines the verified command/receipt with the authenticated task scope, current time and platform origin. `serviceAttachmentRequest()` derives the single allowed URL/method/body. Server validation and editor preparation require an exact component proposal match, compile its source, check its selected control and field types, and preserve all unrelated request behavior. The editor rechecks the final candidate before history. Existing request source hidden by the privacy projection stays unavailable for replacement.

The PVO request body at this stage is a declarative envelope with an operation name and input bindings. **It is not a completed viewer call.** The host rejects this unchanged envelope because it lacks the actual validated input/action ID. Step 1E.03 now saves connection metadata with the component and approved host; 1E.04 must use that metadata to resolve typed fields/literals and retain an action ID for retries. Step 1E.05 must select the creator/test route through server authority. The saved-result flow can apply the checked connection. Try/player invocation and activation remain incomplete, so this is not a usable online export yet.

## Checkpoint

**1E.01–1E.03 are verified in local implementation.** Full checks pass **1,368 tests**, editor types and the actual saved-result browser journey. The background runner uses the current execution claim and metered inference journal, validates actual compiler output and current hosted evidence, and saves immutable result/ready/inference receipts atomically. Browser acceptance covers completion with the page closed, full server restart, checked component/connection/approved-host application, persistent Undo/Redo and protection of a changed draft. Fixtures use a controlled model and local Worker/SQLite, not live-model acceptance.

The fixed per-task model-turn cutoff is removed following the user's correction. [Goal continuation 1B.11–1B.15](1b-goal-continuation.md) is verified, including combined long-running acceptance. Next is **1E.04** for runtime input resolution and action identity. **1E.04 onward remain unchecked.** Project receipt metadata is private authoring data; public export must project only the fields viewers need and must go through the later activation command. No cloud product deployment or complete online component is claimed.


### 2026-10-06 — Shared submission contract verified; 1E.04 still open

The [submission contract](../../../packages/pvo-assistant/attachments/README.md) now resolves typed input, preserves exact action/input across retries, fences changed connection/account scopes and checks matching results. Both actual local HTTP routes recover a lost reply after restart without repeating the action; changed input under the same ID conflicts. Full 1,415-test suite and editor types pass.

Client persistence, generated IDs and runtime integration remain incomplete. **1E.04 is unchecked**; proceed with shared client orchestration and atomic storage, then Try/player wiring. No app availability, activation or public export is implied.


The shared client and IndexedDB adapter are now verified by **1,421 tests**, strict types and a fresh Chromium restart/concurrent-tab check. Saved intent commits before dispatch, unresolved input stays immutable, and late replies cannot overwrite a newer action. Actual local HTTP Try/public replay uses the shared client. **1E.04 remains open** for host slot identity, current-context/account guards and Try/player wiring; no app consumer or new beta release yet.


The component Try server boundary now passes **1,423 tests** and strict editor types. `/api/services/{serviceId}/releases/{releaseId}/try` derives authority from the signed session and exact origin, then checks the selected test release and public-operation audience. Payload flags and private creator receipt replay are rejected. Host runtime wiring and product acceptance remain, so **1E.04/1E.05 stay unchecked**.


### 2026-10-06 — 1E.05 verified; 1E.04 still open

Try now invokes only the selected checked control through the dedicated owner/release/public-operation test authority. Shared persistence records typed literal input and a fresh ID before sending; lost responses replay, failed playback retries recover completed results, and changed account/project/component sessions suppress late effects. The SDK retains deadlines, state and success/error routes; completion commits first. Six host/transport cases and real compiled form/HTTP/SQLite/Chromium IndexedDB acceptance pass, including page/server restart and real one-place capacity. Full suite: **1,429**, strict editor types pass.

**1E.05 is checked; 42/126 roadmap tasks complete.** Public player metadata/invocation and explicit recovery presentation remain **1E.04**, with export descriptor/activation dependencies in 1E.06–09. Beta delivery is recorded separately in progress; no complete usable public export or cloud product deployment is implied.


The public description is now verified by **1,431 tests** and strict types: seven explicit invocation fields, closed validation, no private receipt identity, and common input/request/replay rules. No public player/export consumer exists yet. **1E.04 remains unchecked**; continue with player admission and host transport, deterministic manifest-scoped persistence, static package copying and later activation-gated export projection.
