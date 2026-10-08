# Restyle beta backend connection

[Current progress](restyle-cloud-agent-progress.md) · [Handoff](restyle-cloud-agent-handoff.md) · [Environments](environments.md)

## Authorized scope — 8 October 2026

The creator requested connecting the existing beta to an ongoing backend and explicitly prohibited production. Agent email remains paused. Roadmaps 1–4 retain all 134 completed implementation checkboxes; these deployment tasks are separate.

In plain terms: give the beta app its own online memory and engine. Keep saved tasks, source, releases and records after the browser closes. Start development workshops and Fly Node execution only when needed. Keep beta accounts, media and ownership separate from production. Existing per-call, daily capacity, storage, execution and cleanup controls still apply; no new goal-wide model-turn limit is introduced.

## Deployment checklist

- [x] **BETA.01** Prepare an isolated beta configuration, resource inventory and recoverable handoff; verify no production route, database, bucket or namespace is selected.
- [x] **BETA.02** Provision beta account/media storage and the existing Worker/SQLite/workshop bindings; use independent secrets and development sign-in.
- [x] **BETA.03** Connect the existing inference provider and dedicated Fly Node runtime, verify the immutable image, create only scoped persistent execution credentials and remove temporary build resources.
- [ ] **BETA.04** Serve the existing checked beta app with the backend on one HTTPS origin; verify real sign-in, owner-scoped tasks/Containers, save/reload and authorized execution without production access.
- [ ] **BETA.05** Verify browser and service operation/recovery, record retained resources, cost controls and cleanup; save the GitHub and portable handoff with the exact beta URL.

## Planned ownership

| Resource | Beta target | Lifetime |
| --- | --- | --- |
| App and HTTP backend | Worker `restyle-beta`, separate workers.dev HTTPS origin | Retained for beta use |
| Accounts and sessions | D1 `restyle-beta-accounts` | Retained; initial schemas applied only here |
| Private media | R2 `restyle-beta-media` | Retained; no production bucket reuse |
| Tasks, releases, data, jobs, budgets | New namespaces belonging to the beta Worker | Retained; existing task/service retention applies |
| Temporary development workshop | Container application `restyle-beta-workspaces` | Configuration retained; instances shut down through existing journals/watchdogs |
| Hosted Node execution | Dedicated Fly app `restyle-beta-node`, immutable checked runtime | App/image retained; short invocation Machines destroyed after execution |
| Sign-in | Existing Clerk development instance; beta-owned account rows and session secret | Retained; no production account/session copy |
| AI inference | Existing Runpod hosted model connection | Secret in beta Worker only; existing capacity admission |

Private deployment intent journal: `~/.codex/secure/restyle-beta-backend/journal.json`. It records resource intent before creation and outcomes afterward. Secrets remain outside tracked source and reports. The existing local beta output and editing session are preserved. No integration merge, Actions work, production release or unreleased-branch deletion.

## Continuation

Active branch `codex/restyle-beta-backend` starts at fetched `origin/dev` (`cc2193e`), explicitly fast-forwards completed implementation `eb8226b`, and includes the already verified combined beta `5063d97` at `c27c861`. This keeps the existing app and backend prerequisites together without changing an integration branch. The active source checkout is `/Users/christinasmacbook/.codex/worktrees/restyle-research-connections/pvo-prototype`.

Initial source/configuration `dbf4e5b` and verified Fly/private-policy source **`4c4f3db`** are committed/pushed on the focused branch. [Draft PR #110](https://github.com/jaffakakes/pvo-prototype/pull/110) is attached, open and unmerged. Keep this draft pending the remaining deployment checks.

Current next task: **BETA.04**. The creator approved the fresh Fly connection, and BETA.03 is verified. Actual beta account sign-in remains pending. Keep the private `ASSISTANT_TASK_SPENDING` policy empty until the actual owner is known. No owner grant, saved creator Container or end-to-end authenticated execution is claimed yet. BETA.05 remains unchecked.

### Beta password requirement verified

The creator requested removing the 15-character minimum while signing up. The rule belongs to the existing **Clerk development instance** (`known-dog-5044.clerk.accounts.dev`, `ins_3KEjeAMQnciqyLbSjxEec4Z4csA`), not the Restyle form. A read-only request to its `/v1/environment` initially confirmed `min_length: 15` with compromised-password checks enabled.

The creator completed Clerk management login. The agent prepared **minimum length 15 → 8** in **Development → User & authentication → Password → Update password requirements**, preserving the other settings, and requested the browser policy’s final-action confirmation. The creator then saved the setting themselves. The dashboard now displays **8 characters** and **Reject compromised passwords: On**. An independent reread of the public policy matches the entire saved baseline with only `min_length` changed to **8**; `disable_hibp: false` and `enforce_hibp_on_sign_in: true` remain unchanged. Private before/after receipts are `~/.codex/secure/restyle-beta-backend/password-policy-before.json` and `password-policy-after.json`. See [Clerk password rules](https://clerk.com/docs/guides/secure/password-protection-and-rules).

No app code, application build, Worker deployment or production setting changed. The creator’s already-open signup form still contains the previous 15-character error; it has not been reloaded or submitted by the agent. The creator is asked to close/reopen that form and complete their own password entry, signup and email verification. **BETA.04–05 remain unchecked.** After real sign-in, privately enable only the verified owner’s approved capabilities and resume authenticated backend acceptance. Never bypass the provider rule in the frontend, create a fake owner or grant wildcard access.

## Fly connection verified — 8 October 2026

The old login session expired. The creator completed fresh Fly session `28720`; CLI identity and the browser's connected confirmation agree. The dedicated **`restyle-beta-node`** app belongs to `japhet-de-souza`, using its own private network. No public app port/IP or unrelated app is configured by this setup.

- The existing trusted builder produced **`registry.fly.io/restyle-beta-node@sha256:9942e6c3dccc44a923c70ef9d8b3b7609b1a8338ea05b33ca80047952d0f449b`**. Source digest `1e9fc2ae8cf64dbebc5c9e7c089486755ca788ff925a98ec86091638d52555ff`; unchanged pinned Node.js 24.20.0 and runner digest. No generated creator code or expected answers entered the image builder.
- Temporary builder **`2862907b92de68`** was destroyed and its 15-minute app-scoped registry key was revoked. The beta app/image are intentionally retained. No Machine remains running.
- One actual invocation through the **product `FlyNodeContainer` adapter** checked image/runner identity, delivered the fixed source plus retained `nanoid@5.1.6`, and returned `{result:"accepted",state:{guests:["Beta check"]}}`. Its entire Machine was destroyed and absence confirmed. This is a runtime connectivity probe; it does not impersonate a beta user, publish a Container, test the Worker coordinator's authenticated route, or send a provider message.
- The beta Worker now has only the dedicated app's execution credential, not the CLI/account-wide login. It expires **7 November 2026 at 19:13:01 UTC**. Renew this app-scoped credential before expiry, replace it in the private beta secrets file, redeploy through the guarded command, and verify the affected execution path. Temporary build access is separately revoked.
- Beta task grants are supplied as the **private Worker secret `ASSISTANT_TASK_SPENDING`**, initially `[]`. Tracked beta configuration rejects credentials and account grants. This preserves the existing exact-owner/capability/expiry contract without placing real owner identifiers in Git. The server still fails closed; no account is enabled until actual sign-in is verified.
- Existing two execution slots, shared-CPU/1 GiB invocation Machines, three-minute watchdog, two-second guest call deadline, capacity admission and whole-Machine cleanup remain unchanged. Durable drafts/releases/records stay in beta storage when compute stops. These are execution/capacity controls, not a new goal-wide model-turn ceiling.

Private resource/probe receipts are `~/.codex/secure/restyle-beta-backend/fly-runtime-report.json` and sibling `fly-preflight.json`; the parent intent journal points to them. Logs `/tmp/restyle-beta-connect-fly.log`, `/tmp/restyle-beta-fly-preflight.log`, `/tmp/restyle-beta-fly-deploy.log` and `/tmp/restyle-beta-connected-verification.log` record the successful build, real adapter call, cleanup, deployed secret, anonymous API boundaries and unchanged production version/storage. Worker `a725e90a-0343-4078-9430-0481a83b160f` first connected Fly; current **`08a71df1-aa1b-40c2-a77b-6f141fe96036`** additionally keeps account grants in private configuration. Live Worker secret metadata, beta D1/R2, anonymous/private API boundaries and served release pass. Production Worker version/storage are unchanged. Five focused deployment/Fly credential checks and final full `npm run check` **1,699/1,699** pass, with **1,043 syntax / 1,026 dependency / 793 adopted-formatting files**. Logs `/tmp/restyle-beta-private-grants-check.log`, `/tmp/restyle-beta-fly-final-check.log` and `/tmp/restyle-beta-private-grants-deploy.log` preserve this final source/deployment verification.

## Initial deployment evidence — 8 October 2026

- **Deployed:** https://restyle-beta.jaffakakes28.workers.dev/editor/ ; Worker `restyle-beta`, version `185dd285-48a4-4f14-a855-b51f639386e5`; beta D1 `d5b55822-674a-4f9a-8019-ee10dfa3764e`, all five initial schemas; private R2 bucket; eight Worker-owned SQLite namespaces; `restyle-beta-workspaces` application. These are ongoing beta resources, intentionally retained. No workshop instance has been started in this deployment task.
- **Isolation:** guarded dry run and five focused deployment/Fly credential checks pass. Anonymous sign-in/status reads return 200; task/service/account-connection reads return 401. Production storage bindings are reread and unchanged. Independent stable beta secrets are private; existing local beta4173/session is preserved.
- **AI:** existing Runpod connection accepts hosted-model inventory and **one actual native assistant HTTP request** through the deployed beta, with validated output. The control-plane endpoint returns 403; broader provider access is not claimed. The request creates no Container or external message.
- **Source:** `npm run check` **1,699/1,699**, **1,043 syntax / 1,026 dependency / 793 adopted-formatting files**. The first run's sole style-gap failure was stale generated WASM predating the included combined-beta source. Backup `~/.codex/backups/restyle-beta-compiler-before`; rebuilding unchanged Rust source fixes the focused compiler check, then final full verification passes. Initial Worker `546fe942-bf72-4586-9a4a-088b4e4f4535` is superseded by the corrected version above.
- **Browser:** exact served editor/player/receipt/shared modules and new UI bundle match the verified Roadmap 4 build. Actual desktop/phone email sign-in UI and fresh **activated** service worker pass at `restyle-editor-shell-7bbb710096de4c50`. This proves served assets/auth UI, not completed user sign-in or owned Container execution.
- **Cleanup:** browser fixtures close in `finally`. The later Fly connection above records its completed temporary build/probe cleanup. Retain the successful beta deployment/storage, protected combined-beta worktree and existing local beta server. Private journals record intent and outcomes; never commit credentials. Actual ongoing costs depend on use, with existing capacity/storage/watchdog controls; no invoice total is claimed.

All 485 local links/anchors across 33 related documents pass; all 134 prior task IDs/descriptions/completion states are unchanged. The five separate BETA tasks record actual deployment progress; three are now complete.

Logs on this Mac: `/tmp/restyle-beta-check-final.log`, `/tmp/restyle-beta-deployment-tests.log`, `/tmp/restyle-beta-language.log`, `/tmp/restyle-beta-compiler-regression.log`, `/tmp/restyle-beta-guarded-dry-run.log`, `/tmp/restyle-beta-model-preflight.log`, `/tmp/restyle-beta-served.log`. On another machine, committed resource identifiers, commands and these bounded evidence claims are sufficient for continuation; do not repeat live inference merely to replace a missing log.

Cloudflare environments isolate deployment bindings and secrets; the dedicated configuration here makes beta target selection explicit. See [Cloudflare environments](https://developers.cloudflare.com/workers/wrangler/environments/), [Container configuration](https://developers.cloudflare.com/containers/reference/wrangler-configuration/) and [Fly scoped credentials](https://docs.fly.io/security/tokens).

## Operator commands

The tracked configuration has no secrets. Stage the verified beta build into `.wrangler/beta/assets` (preserve existing output and old assets before any future update). Store beta-only `SESSION_SECRET`, `ACCOUNT_CONNECTION_KEY`, `RELEASE_NOTIFY_TOKEN`, `RUNPOD_API_KEY` and the serialized account policy `ASSISTANT_TASK_SPENDING` (initially `"[]"`) in a private JSON file. The control backend can deploy before Fly is connected; full Container execution additionally requires the app-scoped `SERVICE_NODE_FLY_TOKEN`. Fly runtime connectivity now passes; BETA.04–05 stay unchecked until actual owner sign-in and authenticated execution/recovery pass. The default is `~/.codex/secure/restyle-beta-backend/worker-secrets.json`; another machine can set `RESTYLE_BETA_SECRETS_FILE` to its own private file. Never copy a production session/encryption secret. Run:

```sh
npm run deploy:beta:built -- --dry-run
npm run deploy:beta:built
```

The same trusted Node image builder now admits the explicit beta app name as well as the existing disposable proof namespace. This changes no guest source, runtime image digest, execution privilege or independent test boundary. A prepared Worker configuration is not proof of a successful live request. After deployment, verify real sign-in, the current owner, saved task/draft recovery, independent checks and service execution, and confirm temporary Machines are gone.
