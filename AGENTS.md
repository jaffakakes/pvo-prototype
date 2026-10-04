# Agent coding instructions

These rules apply throughout this repository. Read the [coding standard](docs/engineering/coding-standards.md) before changing code and the [architecture](docs/engineering/architecture.md) when choosing where code belongs. The [code audit](docs/engineering/code-audit.md) records existing debt, not exceptions for new code.

## Core rules

- Give each file one cohesive responsibility and one main reason to change. Closely related private helpers may stay together; unrelated screens, workflows, or rules must not.
- Prefer small, readable files grouped by feature. There is no hard line limit. Files growing toward 500 lines or beyond need an explicit responsibility review and usually a split; extract earlier when responsibilities diverge. Never compress code or JSX to reduce the count.
- Apply SOLID through functions, modules, and narrow interfaces. Do not add class hierarchies, factories, or one-line forwarding modules just to satisfy an acronym.
- Keep business rules, validation, calculations, and state transitions separate from rendering, event wiring, browser APIs, and network effects.
- Put domain models beside domain rules. New domain code must not import React, Zustand, application UI, the DOM, or store types. Pass required data and effect adapters explicitly.
- Use the same command for toolbar, keyboard, and other entry points to the same operation. Do not copy editing or playback rules into each handler.
- Keep entry points and store composition thin. UI components render state and translate interactions into named commands; the store integrates commands and history.
- Follow the [notification policy](docs/engineering/notification-policy.md): approved typed events, short copy, one surface, and no routine edit toasts. Preserve unresolved save/recording status after dismissal.
- This repository is development-only and has no production users. Maintain exactly one current contract: do not add legacy fallbacks, compatibility adapters, dual-read or dual-write paths, migrations, deprecated fields, or support for superseded project/manifest shapes unless the user explicitly requests it. When a contract changes, remove the old behavior and update source, tests, fixtures, and documentation together.

## Ownership and dependencies

- `docs/site/`: documentation website. `docs/language/`: PVO authoring guide. `docs/engineering/`: standards, architecture, audits. `SPEC.md`: canonical format note. Keep each document focused and link related material.
- `editor/`: authoring and recording application. `player/`: viewing application. Neither application may import the other's internals.
- `packages/`: shared format/compiler/runtime code exposed through public entry points. Packages must not import editor, player, server, documentation, or scripts. `server/` and `scripts/dev/` adapters must not import editor/player internals.
- `packages/pvo-language/`: Rust compiler rules under `src/{structure,style,logic,compiler}/`, JSON/WASM exports in `bindings.rs`, and browser initialization in the root JavaScript facade. Follow its package `AGENTS.md`; keep host effects outside the compiler.
- `share/`: public demo landing page and its assets. `scripts/build/`, `scripts/dev/`, and `scripts/checks/`: tooling grouped by purpose. `dist/`, language `pkg/`, and Cargo `target/`: generated output, never the source of a fix.
- Group related files in a feature folder; co-locate its UI, hooks, and styles. Promote code to shared ownership only when the responsibility is genuinely shared.
- During behavior-neutral structural refactors, preserve current public SDK imports, types, schema, and file compatibility. Contract changes use only the new canonical shape under the development-only rule above. Update static build copying, package publication lists, and test servers when adding imported modules.

## Working method

1. Inspect relevant instructions, callers, tests, and `git status`. Preserve existing user changes.
2. Identify the responsibility and dependency direction before editing. Follow the target architecture incrementally; do not create empty scaffolding or rewrite unrelated features.
3. Separate behavior changes from file extraction. Add meaningful regression coverage for moved rules or risky lifecycles where coverage is missing.
4. Keep effects at adapters, release owned media/URLs/listeners/workers, and report failures with useful operation context. Preserve sandbox, request, and confirmation boundaries.
5. Review the diff for mixed responsibilities, duplicated rules, circular imports, unreadable formatting, and stale documentation.
6. Run relevant checks and report what passed, failed, or was not run. Do not imply lint or architectural enforcement exists when it does not.
7. After completing app changes, rebuild the beta with `npm run build` and verify that the running beta serves the new service-worker revision. The user expects changes to appear through **New beta release**, not only in source or a temporary preview. Locate the active beta server's actual output directory: it may serve a separate checkout, so updating this repository's `dist/` alone is not enough. Copy built assets there before the HTML and service worker, retaining old hashed assets for open clients. Preserve pending generated output in a backup before replacing it. Respect an explicit local-only request, and do not force an update or reload over the user's editing session.
8. Finish an authorized production release by cleaning up its completed feature/fix branches under the rules below. Branch cleanup is part of finishing the release, not an optional follow-up requiring another confirmation.

## Branch lifecycle and release cleanup

- Follow the [release workflow](docs/engineering/environments.md): start new work from current `origin/dev` on a focused branch and promote through `dev` → `preprod` → `prod`. Do not accumulate unrelated new work on an already released feature branch.
- After the production deployment succeeds and the live release is verified, delete the completed task's feature/fix branch from both the remote and local repository. A push or merge to `dev`, `preprod`, or even `prod` without a successful deployment is not sufficient.
- Fetch current refs first. Confirm the exact branch tip is included in the successfully deployed production commit, normally with `git merge-base --is-ancestor`. For rebased or squash-merged work, establish explicit change/merge equivalence before deletion; a similar name or an old PR alone is not proof. Never discard unreleased commits.
- Check open PRs, active tasks, worktree changes and running servers before deletion. Preserve branches still in use or containing unresolved source changes. Do not switch another active task's checkout or remove a serving worktree. For a finished inactive checkout, switch or detach safely before deleting its branch; preserve pending files and back up generated output if handling it during cleanup. Generated-only leftovers may remain in a preserved detached worktree rather than keeping a released branch indefinitely.
- Save the deleted branch name and exact SHA in a local recovery record outside tracked source. Recheck local tips immediately before deletion and use expected-SHA leases for remote deletion so concurrent work is preserved. Prune stale remote-tracking refs afterward.
- Keep integration/release branches (`dev`, `preprod`, `prod`) and designated history branches (`main`, `editor`). Delete task branches only; never force-reset, discard pending work, or close an unrelated PR as branch cleanup.
- Report branches removed and any retained branch with its concrete reason. When asked what is pending production, distinguish open feature PRs, changes awaiting promotion/deployment, uncommitted work, and already released leftovers; do not present every remaining branch as an unreleased feature.

## Verification

- `npm run check`: source JavaScript syntax, declared dependency boundaries, adopted-file formatting, and the Node behavior suite.
- `npm test`: recursively discovers `tests/**/*.test.mjs`, with four test files running concurrently by default; override with `npm test -- --test-concurrency=2`. Focused suites can use `node --test tests/sdk/*.test.mjs`.
- `npm run format` / `npm run check:format`: pinned Prettier 3.9.9 for the explicit adopted-file list in `scripts/checks/formatting-scope.json`. Add maintained source files to that list when adopting formatting. This is not repository-wide lint, purity, cycle, or responsibility enforcement.
- `npm run check:editor`: strict editor TypeScript checking.
- `npm run check:language` and `npm run check:language:format`: native Rust behavior tests and formatting. Build WASM with `npm run build:language` and verify browser contracts when compiler or bindings change.
- `npm run build`: product pages, player, shared packages and editor build; this replaces `dist/`. Preserve pending generated changes or use an isolated build directory before running it in a dirty checkout.
- For browser behavior, use `npm run check:browser -- <suite> [checks...]` or the named suite commands. Read [scripts/README.md](scripts/README.md) for browser/server prerequisites. Node and native Rust tests alone do not verify recording, layout, playback, WASM integration, or sandbox isolation.
- A documentation-only change needs link/content verification, not artificial unit tests. Refactors need checks of observable behavior, not assertions about filenames or line counts.

Existing large modules are migration work. Do not expand their unrelated responsibilities; extract a coherent part when the change requires touching that part. Record a specific follow-up if a safe extraction needs a separate change.
