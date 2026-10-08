# Restyle research and saved choices — Roadmap 2A

[Roadmap 2](restyle-cloud-agent-roadmaps/02-research-and-connections.md) · [Public research](web-search.md) · [Progress and continuation](restyle-cloud-agent-progress.md)

## In plain language

Before building a connection to another service, Restyle can investigate the requested action, check which accounts and permissions the creator already has, and save its conclusion. It can distinguish “ready to build”, “needs account setup”, “needs code”, “a person must do this”, and “we still do not know”. A website advertising a feature does not give Restyle permission to use it.

When it needs a choice, Restyle saves a question. The creator can answer while a small, already planned piece of independent research finishes. Other work waits. Returning later keeps the answer and chosen outcome. If account access or supporting documentation changes, Restyle must reconsider the old decision and explain what changed.

This uses the existing saved task. Public research starts no VM. The **VM is the temporary workshop** for code and tests; the **Container is the hosted Node.js service** used by viewers after publication; **PVO Logic** remains the separate restricted component language. Research notes and answers live outside the workshop and running service instance.

The [2D manual-alternative contract](restyle-manual-alternatives.md) extends these decisions with explicit saved consent, agreed form fields and human follow-up that remains pending independently of component readiness.

## What is implemented

| Part | Current behavior and boundary |
| --- | --- |
| `web_search`, `web_read` | Existing bounded public text tools, with no private headers, cookies, scripts or account sign-in. |
| `web_evidence` | Request-specific interpretation tied to an actual same-task page read and exact excerpts. Source/time are supplied by the platform. Interpretation is not independently certified. |
| `connections_read` | Lists this creator's names, providers, status, granted permissions and installed adapter operations. Returns four records per page and a next cursor; there is no four-account limit. No secret fields or credential references. |
| `capability_record` | Saves the requested operation, stable key, proposed/chosen outcome, status, reason, evidence IDs, account observation and optional saved answer ID in the existing task research journal. |
| `ask_research` | Saves one question and up to two independent read-research calls. Only those exact saved calls can run before the answer. More research can follow in subsequent decisions; this is not a total model-turn ceiling. |
| Saved answers/choices | The planner receives recent choices and their freshness. Complete research and archived answers remain available through the existing paged history. |

The [2B private account connection](restyle-account-connections.md) and [2C approved Container account access](restyle-connected-services.md) are now implemented and verified. GitHub is the installed provider; Restyle's Google login still does not grant Calendar or other provider access. The metadata catalog contains only actual installed operations and creator-owned connections. There is no public or model metadata-write endpoint. Historical 2A verification below predates those later capabilities.

## Ownership and responsibilities

- [Connection contract](../../packages/pvo-assistant/connections/index.js) is closed metadata with UTF-8/size bounds. [Connection catalog](../../server/connections/catalog.js) uses SQLite in the existing authenticated owner's task coordinator. Each write compares the expected revision. Revoked/expired metadata remains explicit. The catalog has a version so a previously empty inspection becomes stale after setup. It is account-owned and outlives an individual task's retention.
- [Capability contract](../../packages/pvo-assistant/builder/capabilities.js) and [pure decision rules](../../packages/pvo-assistant/builder/capabilityRules.js) separate interpretation and readiness from effects. [Task research adapter](../../server/assistant/builder/capabilityResearch.js) resolves only same-task receipts, current account metadata and saved answers. No model-supplied owner or authorization is accepted.
- [Research journal](../../server/assistant/builder/researchJournal.js) remains the single task research authority. Intent, usage, dispatch and receipt are saved under the current claim. Exact replay does not execute or charge again. Stop fences late results; expired retained tasks remove settled research. No parallel agent, evidence database or service-hosting authority was added.
- [Task transitions](../../packages/pvo-assistant/tasks/transitions.js) own pending-question state and answer replay. Builder decisions, question and checkpoint commit together. The coordinator gained only catalog composition; its existing scheduling/effects responsibilities were not expanded with provider-specific logic.

### Availability means planning readiness

For external `available`, the task must cite a completed account inspection and documentation evidence for the exact operation. The selected account must still match that observation, be connected, contain the named installed adapter operation, and hold both the adapter's required permissions and the researched requested permissions. Model-written scope names and documentation excerpts cannot supply missing access. A connected account with no installed adapter is insufficient.

`needs_account` and `needs_adapter` require documented support; unclear support stays `unverified`. Manual alternatives may be proposed, but selecting one requires an actual saved creator answer from this task, including archived answers. Restyle component logic and its own Container records can be marked available without an external account. A public API may need adapter code without needing account setup.

All decisions carry `verification: planning_only`. The semantic interpretation of documentation and whether a question is useful remain model judgments guided by the request, existing answers and research instructions. These checks are not an independent proof that every claim is correct. Independent source/service tests and later credential enforcement remain necessary. Research never proves an external action happened.

### Questions and freshness

A task in the build step may be queued/running with one pending question while its saved research batch executes. The editor shows that question immediately and keeps polling. An early answer updates the saved question without cancelling the active read claim. A late answer queues the same task. After the batch, an unanswered question enters `waiting_for_answer`; it cannot advance to validation/hosting, acquire a workspace or choose the unanswered outcome. Stop retains the question but stops further work. Interrupted research is reconciled through existing receipts before reaching the wait.

Choices are matched by a stable key. Their basis digest covers the original request, saved answer count, account catalog/current metadata, cited source content and recent relevant documentation. Re-reading identical text at a new time is not new evidence. Different documentation, a new/revoked account, or a new creator answer makes the old choice stale; original answers are retained. Repeating the exact answered prompt is rejected with a reference to the saved answer. A necessary new question must explain the changed facts. A selected outcome cannot silently change against the same basis.

Context contains up to twenty latest choices and a flag pointing to paged history for more. Freshness includes a bounded window of thirty-two recent distinct documentation sources for the exact operation; full receipts remain in history. This bounds inference context, not task lifetime. A status record is not an execution grant and has no authority to change an accepted service agreement.

## Verification — 8 October 2026

### Controlled behavior

The actual saved runner, local Worker/SQLite and public-fetch adapters were exercised with six unrelated requests. Model replies and these provider pages were controlled fixtures; this does not claim a live model quality evaluation or six real integrations.

| Request | Verified result |
| --- | --- |
| Calendar free/busy | Connected account plus installed read operation and granted scope produces planning availability. Missing scope, absent adapter, revoked/expired account, invented operation or stale observation is rejected. |
| Equipment request in a work tracker | A connected account without the required installed operation records adapter work and asks which work project should receive requests. |
| Personal calendar | Missing selected account records setup, preserving the requested private-data boundary. |
| Restaurant arrangement | A documented telephone route records a proposed human step; selection needs the creator's answer. |
| Previously unused river-gauge request | Undescribed access stays unverified and asks about the changed outcome. No provider-specific production template was added. |
| Volunteer preferences in the creator's project | Existing Restyle records need no external account or public network read. |

Additional tests cover closed fields/secret rejection, pagination, owner/task isolation, exact replay without another charge, source changes, new account setup, conflicting documentation, archived-answer reuse, retention, early/late answers, restart, Stop and forbidden dependent work. The real editor test exercises a visible question during research, saved early answer, the next focused question, phone layout and reload with real IndexedDB and Worker/SQLite. It uses controlled model/public-provider responses.

### Real public service research

The [public proof](../../scripts/checks/cloud-agent-research/public-proof.mjs) read [Google's Calendar free/busy documentation](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) through the actual saved-task research path at **2026-10-08T00:30:59.198Z**, untruncated. Its exact source excerpt was checked; the empty creator account inspection produced a saved `needs_account` decision. After restarting the local Worker, the original source, decision and current status remained available. No VM, paid resource, provider credential, live model or Calendar API operation was used. Local fixture storage/browser processes are removed on exit.

The first attempt used incompatible Node/Worker Request objects in the diagnostic bridge; it returned unavailable and was cleaned up. Passing the request URL and bounded public headers through the bridge fixed the proof harness. Earlier controlled tests also exposed fixture-only missing build bindings, a simulated model-capacity window, and a viewport-transition race in the test; these were corrected without relaxing production gates. The existing regression expectations were updated for the new decision shape. See progress for final suite totals and beta revision.

### Reproduce only when relevant

From a fresh checkout with dependencies and language WASM installed:

```sh
node --test tests/assistant-builder/capabilities.test.mjs tests/assistant-task-server/capability-research.test.mjs tests/assistant-task-server/independent-research.test.mjs tests/assistant-task-server/research-requests.test.mjs tests/assistant-tasks/independent-research.test.mjs
npm run check
npm run check:editor
npm run dev:editor -- --port 5320 --strictPort
# In a second terminal:
EDITOR_URL=http://127.0.0.1:5320/ node scripts/checks/editor/research-question.mjs
# Optional live public-document verification; no provider login or cloud deployment:
node scripts/checks/cloud-agent-research/public-proof.mjs
```

The delivered local beta remains static unless its service/task APIs are separately configured. Source completion, local browser verification, beta assets, permanent cloud hosting, PR merge and production are separate statuses. Production remains prohibited until the user tests the finished roadmap and explicitly approves release.

## Following stage: private connections

The [2B connection boundary](restyle-account-connections.md) extends the catalog with private account setup, controlled provider reads and saved task connection answers. Metadata permissions describe the exact Restyle operations allowed for the saved repository after successful probes; they are not a report of every permission on a token. In particular, a successful public repository read does not establish private-repository access. The completed 2A evidence above remains historical; current 2B completion and real-provider acceptance are recorded in progress.
