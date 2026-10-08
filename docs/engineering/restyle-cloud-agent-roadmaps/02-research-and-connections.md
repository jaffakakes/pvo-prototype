# Roadmap 2: research and connect outside services

[Roadmap overview](../restyle-cloud-agent-roadmap.md) · [Architecture](../restyle-cloud-agent-architecture.md)
Task IDs are stable. Checked items are verified work; update their evidence and the [handoff progress log](../restyle-cloud-agent-progress.md) whenever a task finishes.


**Outcome:** the creator can describe a goal involving an outside service. The agent checks what is possible, asks for a missing decision or connection, and builds the agreed flow.

**Depends on:** Roadmap 1's saved tasks, questions, ownership, workspace, live services and test/live separation, followed by [1G Containers](1g-containers.md) for the planned product sequence. Integrations extend that same Node.js service and management system. Provider research can begin earlier, but real connections must use these boundaries.

## Build from the creator's request

The creator's actual goal determines the plan. Restaurant bookings and the other examples illustrate the behavior; they do not define a fixed set of templates, required fields, providers, or follow-up questions. Apply this rule to all four stages below.

1. Establish the requested result and what would demonstrate success, using the creator's words and existing project context. Ask only about missing decisions that affect the result.
2. Work out the needed capabilities, data, accounts, and steps for that request. Reuse what is already available; research outside services only where needed. A request that existing component logic or Restyle-owned storage can satisfy needs no external connection.
3. Build suitable code and connections from verified capabilities. Keep unknown access or unsupported operations explicit, and ask before substituting a different outcome.
4. Test against that request's agreed result with independent expectations. A working example or provider connection alone does not prove the agent understood another request.

**Acceptance across different requests:** exercise unrelated goals, such as a calendar availability view, an equipment request sent to a connected work tracker, and a restaurant arrangement. These are illustrative test inputs, not a supported-feature list. Include a previously unused goal or changed requirements without adding a special-case prompt or template for it. Across the cases, cover usable access, missing account setup, unavailable automation, uncertain evidence, and a request needing no outside service. Verify that questions, collected fields, generated behavior, and displayed results follow the actual request. A missing connection or unavailable capability must produce an honest next step; do not claim that every provider or action is supported.

## 2A. Research the required capability

- [x] **2A.01** Extend the existing public web tools with structured evidence: source URL, time checked, supported operation, access requirements, uncertainty, and what still needs testing.
- [x] **2A.02** Let the agent inspect the creator's available connection names and permissions without seeing credentials.
- [x] **2A.03** Record whether the next operation is available, needs account setup, needs new adapter code, requires a manual step, or remains unverified.
- [x] **2A.04** Check actual integration documentation and available access for the requested operation. A feature visible on a website does not establish permission to use its private API.
- [x] **2A.05** Ask a focused follow-up only when the evidence or creator's intent is insufficient. Continue independent work while waiting.
- [x] **2A.06** Save the chosen outcome. Reuse prior answers until the creator changes the request or new evidence invalidates them.

**Finished when:** different requests produce relevant evidence, capability decisions, and focused questions under the acceptance cases above. The agent follows the creator's choice, reuses existing answers, and changes its plan when the request or evidence changes. Fixture tests cover each access/outcome branch; a real researched service verifies that the tools also work outside fixtures. Restaurant-specific success alone is insufficient.

**Where to start:** [web tools](../../../server/web/routes.js), [web research design](../web-search.md), and [assistant web instructions](../../../server/assistant/native/webPrompt.js).

**2A.01 evidence, 8 October 2026:** the saved-task planner now records `web_evidence` against an actual same-task page read, with platform-supplied provenance and separately labelled model interpretation. Closed fields, exact excerpts, task ownership, restart/replay, history, cleanup and the saved runner are tested. A real public documentation read is recorded separately from controlled lifecycle tests; no live account integration or model-quality gate is claimed. See [verification](../web-search.md#verification--8-october-2026) and [current progress](../restyle-cloud-agent-progress.md). Subsequent 2A.02–06 are verified in the following completion record; the original 2A.01 evidence remains intact.

**2A.02–06 evidence, 8 October 2026:** account metadata inspection, all five readiness branches, actual documentation/access checks, independent research during a saved question, and retained/invalidation-aware choices are verified. Full 1,630 tests and strict editor types pass; sixteen focused regression checks, six unrelated controlled saved-runner requests, actual editor/phone/reload acceptance and a real public-document → saved decision → restart proof pass. See the [research contract](../restyle-research-contract.md#verification--8-october-2026) and [progress](../restyle-cloud-agent-progress.md) for exact boundaries and beta delivery. No real external account setup, provider action or live model quality evaluation is claimed. Next is 2B.01, selecting one actual integration.

## 2B. Connect one external account securely

- [x] **2B.01** Choose one real integration for the first implementation based on accessible account and test support. Document the exact operations it enables.
- [x] **2B.02** Build the required secure connection flow: provider sign-in or a private key-entry screen. Save a connection reference in the task.
- [x] **2B.03** Keep credentials in the server's protected connection store. Exclude them from model context, workspace files, PVO files, diagnostics, and public URLs.
- [x] **2B.04** Add a controlled server adapter that attaches credentials only for approved destinations and operations. An arbitrary URL in generated code cannot receive them.
- [x] **2B.05** Provide connection status, reconnect, and disconnect operations. Check creator ownership and scope on every call.
- [x] **2B.06** Continue the saved task after account setup without repeating answered questions or completed deployments.

**Finished when:** connect, reload, resume, expire, reconnect, and revoke an account. Each state has a usable next step, and another creator cannot invoke the connection.

**Where to start:** [account identity](../../../server/identity.js), [HTTP helpers](../../../server/http.js), and the focused service/task owners introduced in Roadmap 1. Give connection storage and provider-specific calls their own responsibilities.

**2B implementation evidence, 8 October 2026:** GitHub read-only repository/issue operations are installed through the private setup and encrypted account store. Fixed provider destinations, ownership/revision checks, secret exclusion, typed saved answers and same-task resume pass controlled provider/Worker and actual editor checks. Full **1,642 tests**, strict types, desktop/phone/reload and account-switch acceptance pass. Source `9068ce0` is pushed; combined beta `14e33f0` passes build/types/49 focused checks and is delivered as `restyle-editor-shell-9ba9e267c3671ed5`, with served files and activated service worker verified. See the [connection contract](../restyle-account-connections.md#verification-checkpoint--8-october-2026) and [progress](../restyle-cloud-agent-progress.md).

**2B.05 completion evidence, 8 October 2026:** the creator supplied the token through the private form. The actual GitHub proof passed at **05:37:18 UTC**: authenticated account `jaffakakes`, fixed public repository read, issue-list read (zero current summaries), same saved answer/task after Worker restart, expiry from the actual provider deadline using an advanced isolated clock, reconnection, another-owner rejection and local revocation. The encrypted key and exact local test storage are removed; owned form, Vite and Worker processes are stopped. Final source passes the separately recorded controlled hardening/browser checks. **All six 2B tasks are complete.** The public repository does not prove private-repository permission; no GitHub write or generated Container call was tested. Static beta delivery does not configure permanent account/task APIs. Next is **2C.01**.

## 2C. Let generated services use the connection

- [x] **2C.01** Give the service an approved connection reference and an agreed operation. Keep final access enforcement outside generated code.
- [x] **2C.02** Allow the agent to generate a new integration adapter when research establishes a usable service. Validate its destinations, methods, inputs, returned data, and requested permissions before registering it.
- [x] **2C.03** Keep generated integration code isolated. It calls the controlled connection interface; only trusted platform code attaches credentials. Generated code cannot inspect the resulting private headers or secret-bearing logs. An unfamiliar authentication method needs a separately reviewed platform adapter before that connection becomes available.
- [ ] **2C.04** Test against a provider's test environment or a controlled account. Keep normal Try separated from real effects.
- [x] **2C.05** Store a request receipt before any external write. Use the provider's duplicate-prevention mechanism where available and save its result.
- [x] **2C.06** If the provider's outcome is unclear, retain “needs checking” and inspect the existing action. Do not retry a potentially completed booking or message blindly.
- [x] **2C.07** Keep operations that need prolonged waiting, callbacks, or repeated status checks unavailable for live use until Roadmap 3 supplies that lifecycle.

**Finished when:** a component uses the connected service through a deployed backend, the workspace is off, and revoked permission blocks further calls. Report exactly what was verified: a provider accepting a message is not proof that it was delivered.

**2C local implementation evidence, 8 October 2026:** **2C.01–03 and 2C.05–07 are complete.** Full 1,653 tests and strict editor types pass. Actual desktop/phone creator controls, independent request validation, offline Try, normal component export and separate viewers, explicit write opt-in, restart/unknown-result inspection and revocation pass with controlled provider replies and actual local Node/SQLite. The same cloud driver passes a local browser rehearsal. **2C.04 and the final deployed-backend gate remain unchecked** until the separately approved real-account/Fly proof and cleanup pass. New US$1 authorization is pending; no paid resources or real provider writes have been created. See the [connected Container contract and acceptance plan](../restyle-connected-services.md) and [progress](../restyle-cloud-agent-progress.md). Source `5695c39` is pushed; combined `da6797e` passes build/types/57 checks and is delivered as beta `restyle-editor-shell-e6fc1f6312778640`, with actual served files and activated service worker verified.

This should remain extensible to researched services. The first integration provides a worked example of the connection contract; its brand does not define the whole feature.

## 2D. Make manual alternatives useful

- [ ] **2D.01** Let the agent propose a useful alternative suited to the request when automation is unavailable, explaining how the outcome changes. Examples include preparing a draft, collecting information for a person, or opening a supported provider flow; they are not a fixed fallback menu.
- [ ] **2D.02** Save the creator's choice before changing the component's promise.
- [ ] **2D.03** Add required form fields through existing component commands. Explain what collected data will be used for.
- [ ] **2D.04** Record manual follow-up as pending until a person marks it completed or an actual service result confirms completion.
- [ ] **2D.05** Preserve automatic and manual steps in the same saved task so returning later does not lose context.

**Finished when:** creators with different goals can choose useful manual alternatives, preserve their original context, and see which work remains pending. Neither the editor nor the viewer reports the original external action as completed from a preparatory step alone. For example, an RSVP does not confirm a booking, and preparing a work request does not prove it was submitted.

## Complete this roadmap

Demonstrate a researched request, a saved follow-up question, secure account setup, a connected component, an expired connection, and a creator-chosen manual alternative. Also run the acceptance cases across different requests above. Record each requested result, why the selected approach fits, what was actually verified, and any remaining limitation. One real provider proves its connection; broader controlled cases test the agent's ability to adapt without claiming those providers have live integrations.

Use existing [assistant tests](../../../tests/native-assistant-server.test.mjs) and new focused tests for the connection boundary. Browser checks must cover setup/resume and the component's actual result. A mocked API proves local handling; a controlled provider check proves the real account connection.

Next: [Roadmap 3 — background work](03-background-work.md).
