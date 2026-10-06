# Roadmap 2: research and connect outside services

[Roadmap overview](../restyle-cloud-agent-roadmap.md) · [Architecture](../restyle-cloud-agent-architecture.md)
Task IDs are stable. Checked items are verified work; update their evidence and the [handoff progress log](../restyle-cloud-agent-progress.md) whenever a task finishes.


**Outcome:** the creator can describe a goal involving an outside service. The agent checks what is possible, asks for a missing decision or connection, and builds the agreed flow.

**Depends on:** Roadmap 1's saved tasks, questions, ownership, workspace, live services and test/live separation, followed by [1G Containers](1g-containers.md) for the planned product sequence. Integrations extend that same Node.js service and management system. Provider research can begin earlier, but real connections must use these boundaries.

Use a restaurant journey as one demonstration. Its actual booking route must come from research. The demonstration can end in a real integration or a manual step chosen by the creator; the component must describe that outcome accurately.

## 2A. Research the required capability

- [ ] **2A.01** Extend the existing public web tools with structured evidence: source URL, time checked, supported operation, access requirements, uncertainty, and what still needs testing.
- [ ] **2A.02** Let the agent inspect the creator's available connection names and permissions without seeing credentials.
- [ ] **2A.03** Record whether the next operation is available, needs account setup, needs new adapter code, requires a manual step, or remains unverified.
- [ ] **2A.04** Check actual integration documentation and available access. A booking button on a website does not establish permission to use a private API.
- [ ] **2A.05** Ask a focused follow-up only when the evidence or creator's intent is insufficient. Continue independent work while waiting.
- [ ] **2A.06** Save the chosen outcome. Reuse prior answers until the creator changes the request or new evidence invalidates them.

**Finished when:** given examples with online booking, phone-only booking, and no bookings, the agent explains the actual options and follows the creator's choice. Fixture tests cover each branch; a real researched service verifies that the tools also work outside fixtures.

**Where to start:** [web tools](../../../server/web/routes.js), [web research design](../web-search.md), and [assistant web instructions](../../../server/assistant/native/webPrompt.js).

## 2B. Connect one external account securely

- [ ] **2B.01** Choose one real integration for the first implementation based on accessible account and test support. Document the exact operations it enables.
- [ ] **2B.02** Build the required secure connection flow: provider sign-in or a private key-entry screen. Save a connection reference in the task.
- [ ] **2B.03** Keep credentials in the server's protected connection store. Exclude them from model context, workspace files, PVO files, diagnostics, and public URLs.
- [ ] **2B.04** Add a controlled server adapter that attaches credentials only for approved destinations and operations. An arbitrary URL in generated code cannot receive them.
- [ ] **2B.05** Provide connection status, reconnect, and disconnect operations. Check creator ownership and scope on every call.
- [ ] **2B.06** Continue the saved task after account setup without repeating answered questions or completed deployments.

**Finished when:** connect, reload, resume, expire, reconnect, and revoke an account. Each state has a usable next step, and another creator cannot invoke the connection.

**Where to start:** [account identity](../../../server/identity.js), [HTTP helpers](../../../server/http.js), and the focused service/task owners introduced in Roadmap 1. Give connection storage and provider-specific calls their own responsibilities.

## 2C. Let generated services use the connection

- [ ] **2C.01** Give the service an approved connection reference and an agreed operation. Keep final access enforcement outside generated code.
- [ ] **2C.02** Allow the agent to generate a new integration adapter when research establishes a usable service. Validate its destinations, methods, inputs, returned data, and requested permissions before registering it.
- [ ] **2C.03** Keep generated integration code isolated. It calls the controlled connection interface; only trusted platform code attaches credentials. Generated code cannot inspect the resulting private headers or secret-bearing logs. An unfamiliar authentication method needs a separately reviewed platform adapter before that connection becomes available.
- [ ] **2C.04** Test against a provider's test environment or a controlled account. Keep normal Try separated from real effects.
- [ ] **2C.05** Store a request receipt before any external write. Use the provider's duplicate-prevention mechanism where available and save its result.
- [ ] **2C.06** If the provider's outcome is unclear, retain “needs checking” and inspect the existing action. Do not retry a potentially completed booking or message blindly.
- [ ] **2C.07** Keep operations that need prolonged waiting, callbacks, or repeated status checks unavailable for live use until Roadmap 3 supplies that lifecycle.

**Finished when:** a component uses the connected service through a deployed backend, the workspace is off, and revoked permission blocks further calls. Report exactly what was verified: a provider accepting a message is not proof that it was delivered.

This should remain extensible to researched services. The first integration provides a worked example of the connection contract; its brand does not define the whole feature.

## 2D. Make manual alternatives useful

- [ ] **2D.01** Let the agent propose an explicit change of outcome when automation is unavailable: collect RSVPs, prepare a call brief, provide a supported booking link, or prepare a message draft.
- [ ] **2D.02** Save the creator's choice before changing the component's promise.
- [ ] **2D.03** Add required form fields through existing component commands. Explain what collected data will be used for.
- [ ] **2D.04** Record manual follow-up as pending until a person marks it completed or an actual service result confirms completion.
- [ ] **2D.05** Preserve automatic and manual steps in the same saved task so returning later does not lose context.

**Finished when:** a creator can choose a manual call and still receive a useful component and guest list. Neither the editor nor the viewer claims a table is booked from an RSVP alone.

## Complete this roadmap

Demonstrate a researched request, a saved follow-up question, secure account setup, a connected component, an expired connection, and a creator-chosen manual alternative.

Use existing [assistant tests](../../../tests/native-assistant-server.test.mjs) and new focused tests for the connection boundary. Browser checks must cover setup/resume and the component's actual result. A mocked API proves local handling; a controlled provider check proves the real account connection.

Next: [Roadmap 3 — background work](03-background-work.md).
