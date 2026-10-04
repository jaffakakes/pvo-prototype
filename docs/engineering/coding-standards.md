# Coding standard

Applies to new code and code changed in this repository. [AGENTS.md](../../AGENTS.md) is the agent entry point; [architecture](architecture.md) defines ownership, and the [audit](code-audit.md) records migration work.

## One responsibility per file

A file should answer one clear question: how a particular view renders, how a particular rule works, or how an external capability is accessed. A component and a few private presentation helpers can belong together. A page containing recording, timeline mutations, request policy, and export orchestration cannot.

Split when pieces change for different reasons, have different dependencies, can be tested independently, or obscure the operation being diagnosed. Group the resulting files in one feature folder. Do not replace a large file with an unrelated collection in `utils.ts`, `helpers.ts`, or `lib/`.

There is no hard line limit. Many focused modules will be tens to a few hundred lines. Approaching 500 lines is a review signal; 600–900-line application files normally indicate an overdue split. A shorter file can still violate the rule. Generated output, schema data, and focused fixtures are assessed by their role, not an application-code quota.

Never fit under a target by removing whitespace, packing statements, or squeezing JSX onto a single line. Conversely, do not scatter a cohesive operation among trivial forwarding files. Choose names that explain the responsibility: `splitClip`, `validateOutcome`, `loadProjectAssets`, `Timeline`, or `useRecorder`.

## SOLID in this codebase

| Principle | Required practice | PVO example |
| --- | --- | --- |
| Single responsibility | Separate policy, orchestration, effects, and presentation when they have different reasons to change. | Manifest construction does not own MediaRecorder or download UI. |
| Open/closed | Add behavior through an existing narrow extension boundary when one is needed; avoid repeated feature switches across unrelated modules. | A new host action uses the runtime handler contract. A small exhaustive switch inside the owning rule remains acceptable. |
| Liskov substitution | Implementations of the same contract preserve its inputs, results, errors, and lifecycle guarantees. | Preview and player adapters agree on a shared command's meaning even though their media implementations differ. |
| Interface segregation | Pass only the data/capabilities a consumer needs. | A manifest builder receives a project snapshot rather than the complete `CaptureState` and UI flags. |
| Dependency inversion | Rules depend on explicit data/contracts; outer adapters supply concrete effects. | Playback decisions return a transition; a browser adapter applies it to video and UI. |

Functions and ES modules can satisfy all five principles. Introduce an interface, registry, or abstraction only for a real boundary or demonstrated variation; inheritance and dependency-injection frameworks are not required.

## Separate rules from UI and effects

- **Domain:** project/scene/clip models, editing constraints, layer order, outcome validation, and transition decisions. Prefer deterministic functions with explicit inputs and results. No React, Zustand, DOM, browser storage, fetch, timers, or hidden singleton state; inject time/IDs if needed.
- **Application workflows:** coordinate domain rules and capabilities for importing media, splitting clips, exporting, and previewing. Accept narrow dependencies and make operation order visible.
- **UI:** render state, manage presentation concerns such as focus and menus, and translate events into commands. UI hooks may wire browser events but must delegate business decisions.
- **Adapters/infrastructure:** perform recording, media loading, requests, canvas drawing, sandbox mounting, downloads, and resource cleanup. Keep policy decisions outside these effects wherever possible.
- **State:** compose Zustand, selectors, subscriptions, and history integration. Domain types live outside the store. Preserve atomic updates and undo/redo invariants.

For example, a Split button and the `S` keyboard shortcut should both call the same split command. That command uses a domain function to validate source time and minimum duration, then commits one undoable update. Neither event handler owns the split rule. A timeline's pixel geometry remains in the timeline feature; clip durations and source-time calculations belong in domain code.

Share proven common behavior between the editor and player through package APIs. Keep intentional product differences explicit: Restyle authors two Choice options, while PVO permits a wider range. Do not silently standardize differing action limits or playback behavior during file moves; establish expected contracts and parity tests first.

## Readability and contracts

- Use intention-revealing names, small functions, explicit units, and early returns where they simplify flow. Avoid nested ternaries for business decisions and multi-operation event handlers.
- Format JSX, types, objects, and styles for reading and review. Keep local style modules with their feature; reserve global styles for theme, reset, and shared tokens.
- Keep TypeScript strict. Narrow unknown external input and avoid `any` or assertions that hide an unvalidated boundary. Keep JavaScript ES modules where already used; no wholesale language migration is required.
- Export a small public surface. Keep helpers private unless another consumer needs them; do not use barrel exports everywhere or introduce import cycles. Public package facades are appropriate.
- Validate manifests, user code, media metadata, and external responses at their owning boundaries. Keep schema, declarations, implementation, and documented behavior consistent.
- Avoid duplicate sources of truth. During state extraction, preserve existing scene mirrors and history behavior until a separately verified migration removes them.
- Comments explain invariants and reasons, especially timing and lifecycle constraints. Remove obsolete comments; do not narrate obvious syntax.

## Effects, errors, and diagnosis

Make the owner of each MediaStream, object URL, worker, iframe, event listener, and timer explicit. Release owned resources on completion, cancellation, replacement, and failure. Avoid global mutable state that hides which project or playback session owns a resource. Separate request workflows from React presentation through narrow adapters; abort replaced work and reject late results even if the underlying effect ignores cancellation. Project/account changes must invalidate work belonging to the previous owner. Continuous edits use one preview/commit/cancel transaction across entry points, with cancellation on lost pointer capture, Escape, blur and unmount.

Propagate useful errors at the operation boundary, with a component/scene/asset identifier when relevant. Keep detailed diagnostics separate from concise user messages. Do not swallow errors or report a failed success-action as a failed HTTP request. Avoid logging secrets, full request bodies, or private media.

Follow the [notification policy](notification-policy.md) for editor feedback. Use approved event IDs and short copy, one notification surface per failure, and quiet success for ordinary edits. Do not pass raw exception text to a global notification. Dismissing a work-at-risk banner must preserve its unresolved status and recovery path.

Preserve current safeguards during refactors: exact allowed request hosts, redirect restrictions, explicit request failure handling, viewer confirmation for `open_url`, and sandbox isolation. Generated component UI reaches host effects only through a validated command boundary. Do not replace the sandbox with direct evaluation or weaken policies to make extraction easier.

## Rust and PVO language boundaries

Keep Structure, Style, and Logic rules in their own modules under `packages/pvo-language/src/`. The compiler combines validated data and generates escaped output. Keep JSON envelopes and `wasm-bindgen` annotations in `bindings.rs`; root `index.js` owns browser WASM initialization. Rust domain rules must run in native tests without React, DOM, networking, or playback effects.

Use typed models and explicit `Result` errors at parsing/validation boundaries. Preserve diagnostic codes, messages, source positions, serialized shapes, browser exports, and language/security limits during structural moves. Grammar or policy changes need their own expected-behavior cases. Prefer a modest public facade over exposing every internal module.

Follow the package [agent rules](../../packages/pvo-language/AGENTS.md) and [ownership guide](../../packages/pvo-language/README.md). Run native tests and rustfmt, rebuild the web-target WASM, and check browser integration for relevant changes. Keep `Cargo.lock`; treat `target/` and `pkg/` as generated output. Do not hand-edit WASM bindings or use a passing native test as proof of browser compatibility.

## Verification and review

Test behavior at the boundary that owns it. Pure rules should have focused cases for invariants and failures. Adapter/workflow tests should cover consequential cleanup and failure paths. Browser checks should cover the affected user journey. Prefer existing coverage; add tests when a changed rule or risk is not covered. Do not create tests that merely mirror implementation, file layout, or line counts.

| Change | Relevant validation |
| --- | --- |
| SDK/domain/runtime rules | `npm run check`, plus focused cases for changed behavior. |
| Rust compiler or bindings | `npm run check:language`, `npm run check:language:format`, WASM build, and relevant language/browser contract checks. |
| Editor TypeScript/state/UI | `npm run check:editor`; Node suite for rule/history changes; affected browser workflow for interaction or media changes. |
| File/module/build boundaries | Appropriate syntax/type checks and a production build; check static module paths and published package contents when those boundaries change. |
| Sandbox or host commands | Relevant browser isolation and editor/player command checks, including rejection and cleanup behavior. |
| Documentation only | Link, command, and content verification. |

`npm run check` runs JavaScript syntax checks, `check:architecture`, `check:format`, and the same Node test suite as `npm test`; running both test commands is redundant without a reason. Syntax discovery excludes generated Cargo/WASM directories. Node behavior tests are discovered recursively under `tests/`, so focused folders such as `tests/sdk/` and `tests/server/` are included. The runner defaults to four concurrent test files; override with `npm test -- --test-concurrency=2`. Browser checks live under `scripts/checks/{editor,player,language,runtime}/`; use the named npm commands and [documented prerequisites](../../scripts/README.md).

The build replaces `dist/`. Preserve existing generated changes or validate in an isolated checkout/output tree. Do not edit generated bundles to fix source. When splitting package modules, update static copying, publication allowlists, type exports, and test servers in the same change.

Before finishing, review file responsibilities, dependency direction, shared rules, lifecycle/error handling, public compatibility, and documentation. Report the checks actually run and remaining limitations. Rust formatting is checked with rustfmt. Pinned Prettier 3.9.9 formats only files listed in [`scripts/checks/formatting-scope.json`](../../scripts/checks/formatting-scope.json): `npm run format` writes that adopted set, and `npm run check:format` verifies it. Add maintained files deliberately rather than reformatting untouched source.

`npm run check:architecture` inspects static imports/exports, literal dynamic imports/requires and import types under editor, player, server, packages and `scripts/dev`. It rejects domain-to-outer-layer, state-to-presentation, editor/player, server/dev-to-browser-app and package-to-consumer imports (including scripts). It does not prove cycle freedom, purity, cleanup or renderer parity. There is no general-purpose linter; names, cohesion, comments and unenforced dependency rules still need review.

## Incremental adoption

Existing debt is listed in the [audit](code-audit.md). New code follows these rules immediately. When changing an existing mixed file, extract the relevant cohesive responsibility if it can be verified safely. Keep structural refactors behavior-preserving; make functional changes separately. Do not undertake a repository-wide rewrite just to comply, and do not use legacy structure as permission to add another unrelated responsibility.
