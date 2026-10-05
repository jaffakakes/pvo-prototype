# Roadmap 1: build the first working component

[Roadmap overview](../restyle-cloud-agent-roadmap.md) · [Architecture](../restyle-cloud-agent-architecture.md)
Task IDs are stable. Checked items are verified work; update their evidence and the [handoff progress log](../restyle-cloud-agent-progress.md) whenever a task finishes.


**Outcome:** a creator asks for a component, answers any necessary question, and receives a working feature with newly generated backend code. It works in Try, a downloaded PVO, and a published player after its build workspace has stopped.

**Starting point:** the existing editor assistant, account system, PVO request support, and Cloudflare application. No cloud builder is implemented by this roadmap document.

Use two demonstrations: a dinner RSVP with a capacity rule, and an equipment request with date-overlap rules. The agent must write the relevant business rules for each request. Shared hosting and storage tools can be reused; the demonstrations must not be special cases hard-coded into Restyle.

## 1A. Prove the chosen infrastructure

Build this before committing to a provider-specific implementation.

**Progress, 5 October 2026:** **1A passed.** A real Linux workspace wrote and tested a service, saved its output, and was deleted. The separately hosted service still worked. Runtime limits, failure/timeout cleanup, and removal of all proof resources passed. See [results, costs, limits, and remaining work](../restyle-cloud-infrastructure-proof.md). These limits apply to the controlled infrastructure proof; product task, service, and spending controls remain in later steps.

- [x] **1A.01** Check the actual account can run an isolated development workspace and separately deploy a small live service. Cloudflare is the initial candidate described in the architecture; confirm current access, pricing, limits, and runtime support.
- [x] **1A.02** Choose numeric limits for build duration, concurrent workspaces, memory, runtime processing, package downloads, requests, stored data, and spending. Put enforcement in the platform.
- [x] **1A.03** Create one disposable workspace, run a small program, save its output outside the workspace, and stop it.
- [x] **1A.04** Deploy a separate temporary test service and call its stable address after the workspace has stopped.
- [x] **1A.05** Record required platform credentials, where they will be held, the runtime selected, and the observed results. Keep credentials outside prompts and generated code.
- [x] **1A.06** Remove the disposable resources and verify cleanup.

**Finished when:** a real test proves the workshop can stop while the separately hosted service continues working, and you can account for and remove every resource created.

**Where to start:** [Cloudflare configuration](../../../wrangler.jsonc), [server entry point](../../../server/index.js), and [deployment setup](../cloudflare-publishing.md). Add provider adapters with narrow responsibilities; keep generated creator code outside the main application deployment.

## 1B. Save the task and its questions

The task record is the agent's notebook. It must be saved on the server. Follow the [detailed 1B implementation plan](1b-saved-tasks.md) for contracts, build order, and failure tests.

- [ ] **1B.01** Define one shared task contract: owner, project identity, original request, expected behavior examples, bounded component context, project fingerprint, current step, questions, answers, completed tool results, and resource references.
- [ ] **1B.02** Keep the local draft linked to that identity without requiring the whole video project to be uploaded. A project copy needs an explicit decision about whether it shares or creates a service.
- [ ] **1B.03** Add authenticated create, read, answer, resume, and stop operations. Check ownership on every operation.
- [ ] **1B.04** Run cloud-building work through a saved server task that can continue across separate requests. Preserve ordinary editor edits through the current editing command path.
- [ ] **1B.05** Add a background authoring runner with saved checkpoints, wakeups, bounded retries, and one active worker owning each task step. Its lifetime must not depend on an open HTTP request or browser tab. Viewer jobs in Roadmap 3 are a separate responsibility.
- [ ] **1B.06** Add a small progress view in the existing assistant conversation. Start with “Working,” “Needs your answer,” “Ready,” “Stopped,” and “Failed,” with a specific reason.
- [ ] **1B.07** Save prepared component changes while the editor is closed. Apply them on return only after checking the current local project.
- [ ] **1B.08** Record completed steps so restarting a task cannot repeat a deployment or other completed action.
- [ ] **1B.09** Reconcile interrupted steps with provider resource records before retrying. A deployed service whose reply was lost must be recovered and recorded.
- [ ] **1B.10** Pass the saved-task acceptance matrix, record test and browser evidence, and verify the new beta revision for the completed app changes.

**Finished when:** close the editor during an active build and while a question is pending. The build continues, or waits for the saved answer, and the same task resumes on return. Restarting its worker reconciles completed effects before retrying and creates no duplicate deployment. A different account cannot read or answer it. Stopping the task prevents new work from starting.

**Where to start:** [assistant workflow](../../../editor/src/features/assistant/assistantRequestWorkflow.ts), [session coordinator](../../../editor/src/features/assistant/useAssistantSession.ts), [thread store](../../../editor/src/state/assistant/threadStore.ts), and [assistant server routes](../../../server/assistant/native/routes.js). Add focused server task storage and coordination rather than enlarging the existing route module.

## 1C. Let the agent write and test backend code

- [ ] **1C.01** Agree on a small service package: source files, locked dependencies, runtime target, supported operations, input/result descriptions, and tests. An operation means one thing the component can ask the service to do.
- [ ] **1C.02** Start one isolated workspace per task. Restore files from saved source when resuming.
- [ ] **1C.03** Give resource creation a stable task identifier. If a create response is lost, look up the existing workspace or deployment before creating another.
- [ ] **1C.04** Expose bounded tools for reading/writing workspace files, running commands, and reading test results. Advertise each tool to the model only when its adapter is available.
- [ ] **1C.05** Connect those tools to the planner's loop. The agent must use actual command and test results to correct its code; a successful-looking message is not a completion receipt.
- [ ] **1C.06** Allow the minimum research and package access needed. Exclude platform administration credentials and other creators' data.
- [ ] **1C.07** Run tests and produce a saved source bundle with an exact content identifier and test report.
- [ ] **1C.08** Check the requested behavior using cases saved before generation, alongside platform-owned validation of isolation and input/output rules. Deployment readiness comes from the trusted test runner, not a success file or claim written by generated code.
- [ ] **1C.09** On Stop, timeout, or failure, terminate running commands, release the workspace, and preserve completed source and results.

**Finished when:** the agent generates and tests both demonstration services from their requests. A restart restores its saved work. Invalid code fails the test gate, and model claims cannot bypass that gate.

**Where to start:** [shared assistant contract](../../../packages/pvo-assistant/native/index.d.ts), [response schema](../../../packages/pvo-assistant/native/schema.js), and [model service](../../../server/assistant/native/service.js). Give cloud-building instructions and tool execution their own focused modules.

## 1D. Run the finished service and manage its data

- [ ] **1D.01** Add owned service and release records. Link each release to its exact source bundle, test result, runtime, operations, and storage permissions.
- [ ] **1D.02** Deploy releases inactive. Separate test data and permissions from live data and permissions.
- [ ] **1D.03** Create a stable Restyle address that routes to the recorded release. Validate input and ownership before generated code runs.
- [ ] **1D.04** Provide durable service storage with boundaries between creators and between services. Include atomic updates: checking and taking the last place must happen as one protected operation. The same protection applies to overlapping equipment bookings.
- [ ] **1D.05** Add a saved action identifier and result record. Retrying the same action returns its prior result; reusing that identifier with different input is rejected.
- [ ] **1D.06** Implement creator controls to inspect, activate, pause, and delete services, with limits enforced outside the generated program.
- [ ] **1D.07** Clean up abandoned inactive releases and failed deployments. Retain active services until an explicit lifecycle action stops them.
- [ ] **1D.08** Keep the prior active release available during an update. Returning to it must be safe for the current stored records.

**Finished when:** test and live records stay separate; one creator cannot access another's private operations; repeated submissions do not create duplicate replies; two different guests cannot both claim the last place; pause blocks new work; deletion follows the documented retention rule.

**Where to start:** [reply API](../../../server/replies/routes.js) and [reply repository](../../../server/replies/repository.js) demonstrate ownership and public submissions. Reuse their established boundaries without turning that feature into a general hosting module.

## 1E. Attach the service to PVO and activate it

- [ ] **1E.01** Add a validated attachment command that consumes a real service receipt: owner, project, release, operation, input/result agreement, and readiness. The agent cannot attach an invented address.
- [ ] **1E.02** Update both server and editor assistant validation to admit this verified attachment. Keep existing protections for unrelated request changes.
- [ ] **1E.03** Prepare the component and request together. Use the existing history commands, compilation, approved hosts, success/error routes, and response state.
- [ ] **1E.04** Define how Try and the player create a stable action identifier and reuse it on retry. Use one shared contract, with server validation.
- [ ] **1E.05** Make Try use a server-authorized test connection. Changing a payload or test label cannot authorize a live operation.
- [ ] **1E.06** Introduce one activation command used by both interactive download and link publication. Export is already available separately from publishing.
- [ ] **1E.07** Prepare a matching component/service release, activate it before handing out the usable file or link, and retain a retryable result if delivery fails. If activation fails, do not claim the export is ready for online use.
- [ ] **1E.08** Track the active connection even if the client disconnects during delivery. A failed browser response is not proof that the exported file was never received.
- [ ] **1E.09** Verify a downloaded PVO can call the service from a supported player on another origin. Public viewer actions must not depend on the creator's browser cookie.

**Finished when:** Try writes only test records; a real downloaded PVO and a published PVO write live records to the right service; online export works with publication hosting disabled. A stale editor project cannot receive an unintended change.

**Where to start:** [assistant policy](../../../packages/pvo-assistant/policy.js), [server validation](../../../server/assistant/native/policy.js), [assistant commit](../../../editor/src/state/assistant/nativeCommands.ts), [component actions](../../../editor/src/domain/components/actions.ts), [manifest export](../../../editor/src/domain/export/manifest.ts), and [player requests](../../../player/actions/runtime.js).

## 1F. Verify the complete first release

- [ ] **1F.01** Run both demonstration requests from ordinary natural-language prompts.
- [ ] **1F.02** Include a follow-up question, stop/resume, and one invalid generated program that the agent repairs from real test feedback.
- [ ] **1F.03** Close the editor during an active build and restart the authoring worker. Verify saved work continues and completed effects are recovered.
- [ ] **1F.04** Shut down the workspace and close Restyle. Use the finished component from a separate viewer session.
- [ ] **1F.05** Exercise duplicate submissions and distinct simultaneous submissions competing for the last place or overlapping equipment dates. Also check wrong-account access, test/live separation, a failed deployment, and an interrupted export.
- [ ] **1F.06** Remove a local component and check that a published copy's service is still manageable. Explain that editor Undo does not reverse saved viewer actions.
- [ ] **1F.07** Record the actual resource use and confirm the configured limits and cleanup work.
- [ ] **1F.08** Complete the relevant source checks and real browser/provider checks, then release through the active beta and normal promotion process.

**Release gate:** all six steps pass. A mock provider, a temporary VM URL, or generated source alone does not prove this roadmap is finished.

Next: [Roadmap 2 — research and connections](02-research-and-connections.md).
