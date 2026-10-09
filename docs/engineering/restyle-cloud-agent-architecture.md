# Restyle cloud agent: from an idea to a working component

Status: product architecture, updated 7 October 2026. The [progress log](restyle-cloud-agent-progress.md) distinguishes verified implementation from planned capabilities. Containers implementation follows the completed 1F beta; source, provider and delivered-beta status are recorded separately. Existing 1E/1F completion evidence is preserved.

For ordered implementation tasks and completion checks, start with the [implementation roadmaps](restyle-cloud-agent-roadmap.md).

## The idea

A creator should be able to say what they want a component to achieve. Restyle's agent should work out what is needed, research the options, ask useful follow-up questions, build the missing pieces, and connect everything.

For example:

> “Make a component so my friends can join me for dinner at this restaurant.”

The agent would find out whether this means collecting RSVPs, reserving a table, sharing a booking link, or arranging something by phone. It would use information already supplied and ask about decisions it cannot reasonably make.

This is an open-ended building capability. Restaurant bookings, invitations, messages, quizzes, and shared lists are examples. The system should be able to write suitable new backend code when an existing service does not cover the request. A backend is the part of an application that runs online, stores information, and talks to other services.

The creator should not need to know which server to buy, how to write an API, or where a password belongs. They should see questions about their goal, a secure way to connect accounts, progress, and a working result.

**Request interpretation, clarified 8 October 2026:** derive the needed capabilities, questions, collected information, and success checks from each creator's actual request and project context. Reuse known answers and existing capabilities; a request that needs no external service should not be forced through account setup. When the goal changes, revise the plan and tests. Verify this behavior with unrelated and previously unused requests under [Roadmap 2's acceptance cases](restyle-cloud-agent-roadmaps/02-research-and-connections.md#build-from-the-creators-request). Examples are illustrations, not product templates or a fixed capability list.

## How it would feel to use

The following is an illustrative conversation. The restaurant's rules would have to be researched for the actual request.

**Creator:** “Make a component so friends can join me at North Street Kitchen on Friday.”

**Restyle:** “How many places are you offering, and what time?”

After checking the restaurant's website, the agent might discover one of these situations:

| What the agent finds | What it does next |
| --- | --- |
| A usable reservation service is available | Connects the required account, builds the booking flow, and tests it. |
| Bookings are taken only by phone | Offers to collect RSVPs for the creator to call, or explains the calling connection needed to automate the call. |
| The restaurant does not accept bookings | Offers an RSVP component and a way to send meeting details to people who accept. |
| The available information is unclear | Explains what it could verify and asks the one question needed to continue. |

If the creator chooses messages, Restyle might say:

> “I'll ask people for their name and phone number when they accept. Connect a supported messaging service here so I can send the details.”

If the creator prefers to send messages personally, the agent could prepare a guest list and message draft. Switching from a confirmed restaurant booking to an RSVP requires the creator's agreement because those are different outcomes.

The agent keeps working on parts that do not depend on an unanswered question. A draft remains clearly marked as unfinished while a required connection is missing. A service being listed in search results does not prove that Restyle can use it; the agent must check the actual access requirements.

## The main parts

Think of the system as an assistant with a notebook, a workshop, and a place to run the finished work.

| Part | Plain-language job |
| --- | --- |
| Restyle conversation | Where the creator makes a request, answers questions, connects accounts, and sees progress. |
| Task coordinator | Keeps track of what needs doing, what has succeeded, and what the agent needs next. |
| Research tools | Read websites and documentation, inspect available connections, and check how a service can be used. |
| Temporary VM / workshop | An isolated computer where the agent writes code, tries ideas and runs tests; it stops after the work is saved. |
| Connection vault | Protects account connections and private keys used by the finished service. |
| Restyle Container | The creator's saved hosted Node.js service, used by components after publication; implemented in 1G with acceptance tracked separately. |
| Saved records | Store replies, bookings, service code, settings, and progress so they survive restarts. |
| Restyle gateway | A stable online address that checks each request and sends it to the correct service. |
| PVO component | The visible form, buttons, choices, and results that the viewer uses. |

~~~mermaid
flowchart TD
  Creator["Creator asks Restyle"] --> Agent["Agent and saved task"]
  Agent <--> Research["Research and available connections"]
  Agent <--> Questions["Follow-up questions and account setup"]
  Agent --> Draft["Saved draft and local preview"]
  Draft -->|Development tools needed| Workshop["Temporary cloud workspace"]
  Workshop --> Draft
  Draft --> Check["Independent release tests"]
  Check --> Release["Deploy a service release"]
  Release --> Service["Live service"]
  Release --> Link["Connect the PVO component"]
  Viewer["Viewer uses the component"] --> Gateway["Stable Restyle address"]
  Link -. "tells the component where to send requests" .-> Gateway
  Gateway --> Service
  Service <--> Records["Saved replies and other records"]
  Service <--> Outside["Connected services"]
  Service --> Gateway
  Gateway --> Result["Component shows the result"]
~~~

The agent builds the feature during authoring. The finished feature then works for viewers without keeping that building conversation or its temporary computer open.

## Containers: the next product feature

Think of four simple jobs:

| Part | Everyday comparison | Purpose and lifetime |
| --- | --- | --- |
| **VM / workshop** | A workshop where something is built | The AI writes code, experiments and tests. It can shut down after saving the work. |
| **Container** | The finished service handling visitors | Runs approved Node.js code for viewers. Restyle can let an instance sleep and start another when needed. |
| **Saved storage** | A filing cabinet | Keeps drafts, published code, test reports and viewer records when either computer stops. |
| **Component** | A front desk | The visible form or button sends an allowed request and shows its result. |

For a dinner RSVP, the AI uses the workshop to build and test the capacity rule. The Container runs that rule when someone presses Join. Saved storage remembers who joined. The component shows whether their place was accepted.

Technically, the workshop itself can use a provider container. The product terms distinguish purpose: temporary development and hosted viewer execution. A published service does not require one computer to run forever; its saved identity and data must outlive each instance.

Creators get a **Containers** destination outside Components. They can open the JavaScript the AI built, change it manually, ask the AI to continue from the same saved draft, test it and publish an approved version. Both editing paths use the same save command and independent tests. Editing a draft leaves the published version serving viewers until the checked replacement is activated.

**Reuse the existing service system.** A Container keeps the existing service identity, owner/project rules, releases, data, retry receipts and management commands. Evolve the current service manager and replace its generated-code execution adapter with Node.js Container hosting. Add a durable editable draft and code views. Keep one task runner, one publication flow, one data authority and one component attachment contract.

The current source uses one checked **Node.js** package/runtime through a private Fly execution adapter. Independent validation, inactive probes and live/test calls share the artifact and controller. Saved source, records and replies remain in the existing Restyle service. Beta `restyle-editor-shell-0aeb35ad18374509` contains the Node contract and management views. [Integrated Fly acceptance](restyle-node-product-acceptance.md#verified-result--7-october-2026) and cleanup pass; the static beta has no service/task API configured. The workshop separately runs development tools and restores the platform’s supported libraries offline. Historical Worker test results remain valid evidence of the earlier implementation.

A component chooses an approved operation on a published Container; Restyle supplies the checked connection. There is no external hosting setup or server URL to paste. **PVO Logic stays its own restricted language.** The backend source is JavaScript for Node.js.

[1G Containers](restyle-cloud-agent-roadmaps/1g-containers.md) owns this plan. It follows 1F, adds eight unchecked tasks and brings twelve existing update/management tasks forward without changing their IDs. Plugins, a marketplace, sharing Containers with other creators and installer-specific credentials are outside this update. Roadmaps 2/3 keep their existing integration and background-job responsibilities.

## Use the device and cloud for the jobs they suit

Editing, component previews and supported lightweight checks run on the user's device. Saving the shared draft and tracking the AI's progress use the existing server. A conversation, follow-up answer or simple code edit does not itself require starting a workshop.

Start a temporary cloud workshop when development actually needs package installation, Node.js tools or heavier execution. Save its work outside the machine and stop unused compute. Local work may pause when the browser closes; already authorized cloud work resumes from its saved task. The UI must distinguish unsaved local edits, saved progress, running work and waiting work.

Restyle independently checks the exact release in its controlled Node.js environment before publishing. A local test result gives feedback but cannot authorize publication. The finished Container and shared records remain hosted so viewers can use them when the creator's phone or computer is off.

This can reduce workshop costs; hosted model calls, release checks, live hosting and storage still cost money. Measure those categories separately. The first version reuses the current editor, sandbox, task runner and workspace tools. A full local Node.js installation or second local agent is outside this milestone. Follow [1G's device/cloud rules and acceptance](restyle-cloud-agent-roadmaps/1g-containers.md#where-work-runs-use-the-device-first-where-it-fits).

## When the agent needs a cloud computer

Research can use search and browser tools without starting a VM. Connecting an existing service may also be possible without creating new code.

The cloud workspace starts when the task needs development work: installing a library, trying an integration, writing a backend, running a local server, or testing how the pieces behave together. A VM is one way to provide that workspace; an isolated container can serve the same purpose.

Each task gets its own workspace with only the files and access it needs. The agent can start a temporary server there and test the component against it. Restyle saves the source code, build instructions, test results, and task progress outside that computer before shutting it down.

The workspace has a time and spending limit. Its network access is controlled, and it has no general access to Restyle's production accounts or other creators' data. Websites and downloaded files can supply useful information; their text cannot authorize new actions or change the creator's request.

The finished component calls a stable hosted service. Its working address must survive the temporary workspace shutting down. Cloudflare's current sandbox tools support Linux development environments, and their documentation explains that files disappear when the container stops unless they are saved. That makes the distinction between a workspace and a live service essential. See [Cloudflare sandbox documentation](https://developers.cloudflare.com/agents/tools/sandbox/).

## How one request becomes a working feature

1. **Understand the outcome.** Record what the creator wants, who will use it, and what “finished” means. Separate an RSVP from a reservation, and a message draft from an automatically sent message.
2. **Find a workable route.** Research the relevant service and inspect connections already available to the creator. Choose an existing integration, new backend code, or a manual step that the creator agrees to.
3. **Ask for missing information.** Ask about required details, unavailable accounts, or changes to the outcome. Explain what connecting an account enables. Use a secure connection screen for sign-in or keys.
4. **Prepare the component and backend.** Build both against the same agreement: what the component sends, what the service does, and what result comes back.
5. **Test the flow.** Check valid input, bad input, missing access, timeouts, repeated clicks, and service failures. Ordinary Try uses separate test records and test connections, or simulated external actions. The server enforces this: changing a field in a component cannot turn a test into a real booking or message.
6. **Deploy a service release.** Upload the tested code in an inactive state and check its hosted address through the test route. Prepare its saved data and approved connections.
7. **Connect the component.** Save the real service address in a PVO request validated by Restyle. Apply the editor changes only if the project still matches the version the agent worked from.
8. **Make it ready for sharing.** Show what is ready, which real actions it will perform, and any remaining requirements. Use the creator's existing authorization; ask only for an action or cost they have not authorized. Activate the verified service connection through the shared export/activation workflow before handing out an interactive download or published link. Downloading a connected PVO does not require creating a Restyle publication.

A failed setup should give a specific next step, such as “Reconnect your messaging account.” Research and completed work remain available so the creator can resume.

## What PVO would do

PVO provides the viewer-facing part and a way to call the service. For example, pressing “Join dinner” sends the guest's submitted details to the connected backend. The backend records the answer and starts whatever follow-up the creator configured.

PVO already has online requests, technically called HTTP requests, saved response state, response conditions, and text templates that can reflect results. These are useful foundations. The current Restyle PVO Logic language exposes a smaller set of actions than the broader PVO format: a request in that language has fixed success and error playback routes. See the [format specification](../../SPEC.md#actions) and [Logic guide](../language/README.md#logic).

The first implementation can use the existing request boundary for a form that submits information and shows a meaningful result. A richer interface, such as a live list of available reservation times, may need targeted improvements to component controls and how they display response data. Those changes should be justified by a concrete interaction.

Server code and private credentials live in the hosted service. PVO carries the component and its public service address. Its existing approved-host checks remain in place. The agent gains a checked way to attach a service that Restyle has actually created or verified; a model inventing a URL is never sufficient.

This keeps external services usable from an exported PVO as well as the Restyle player. A downloaded file still needs an Internet connection and a running backend for its online features.

## How the service connection works

Restyle should give each deployed service a stable address. Behind that address, a gateway checks the request, finds the correct service release, and forwards the allowed inputs.

The connection between a component and its service needs to record:

- The creator who owns it and the project it belongs to.
- The service release and operation the component calls.
- The information that operation accepts and the result it returns.
- Whether anyone can submit, or whether a viewer must identify themselves.
- The permitted external actions, connected accounts, and usage limits.
- Whether the connection is being tested, live, paused, or unavailable.

An address inside a shared video is visible to its viewers. It cannot be treated as a private master key. A public RSVP form can accept replies, while reading everyone's private details requires the creator's account. Entering a phone number does not prove that the viewer owns that number.

Each service gets access only to its own records and explicitly connected resources. The gateway validates inputs and limits repeated requests. If the same viewer action is retried, the service uses the same action identifier to avoid making another reservation or sending another message.

Browser access must work from supported external PVO players too. The live endpoint needs the correct browser access settings and its own access checks; it cannot rely on the viewer having the creator's Restyle login.

## Where accounts, messages, and calls fit

The agent asks the creator to connect an account through Restyle. Private keys go into the connection vault and stay out of model messages, the development workspace, exported components, public URLs, and ordinary logs. The connection service adds the necessary credentials when it makes an approved call.

The agent can use the approved connection through a controlled tool. The finished service receives permission to perform the specific operation it needs. Disconnecting the account removes that access and gives the creator a clear explanation of which components are affected.

A cloud computer does not automatically provide a phone line, a booking partnership, or an iMessage account. Each requires a real service or a connected device with the appropriate access. If access is unavailable, the agent can offer an alternative or prepare a manual step.

Restyle's existing iMessage feature demonstrates a connected-device approach: a running Mac receives a queued test request and sends a fixed message through Messages. It is currently a limited test, not a general notification service. An iMessage workflow would need further work on that sender and its lifecycle. See the [iMessage test design](imessage-test.md).

The creator's component should describe the action clearly. “Accept and receive the dinner details” lets the guest understand why their number is being collected. If the creator chooses manual messaging, the component should promise only the RSVP or follow-up that will actually happen.

## Work that continues after the browser closes

Building a backend can take longer than a normal editor change. It can also stop temporarily while the creator signs into another service. Restyle therefore needs a saved task record that survives closing the app.

That record holds the request, relevant research, decisions, open questions, source code, test results, deployed resources, and the project version the agent used. It also records which actions have already happened so resuming does not repeat them.

Cloud building requires a creator account and a saved project identity. The cloud receives the component details and task context it needs; this does not require uploading all the creator's video. If the editor closes, backend work can finish and the component edit waits for the creator to return. Restyle then checks it against the actual local project before applying it.

The creator sees ordinary language such as “Researching,” “Waiting for your connection,” “Building,” “Testing,” or “Ready.” Progress reports describe completed work and the next dependency. Closing a progress panel does not erase the task.

Background actions from viewers need their own saved records. If a message or reservation takes time, the component receives a receipt meaning “request received.” It can later show the recorded outcome. “Request received,” “booking confirmed,” and “message delivered” are different facts; each label requires evidence for that fact.

This will require work beyond today's brief editor request loop. Long-running result updates may also need additions to the player and authoring controls. A background job can continue on the server even when the viewer closes the video.

## What happens when something changes or fails

**A service is slow.** Save the job and show its pending state. Check the existing job before retrying an external action. An unclear reply from a provider must not lead to another booking automatically.

**The creator changes the project during a build.** Keep the prepared work, compare it with the current project, and update the proposal. Apply changes through the normal editor commands and history once they are valid.

**The creator stops a build.** Stop pending work and release its temporary computer. Preserve research, completed work, and a record of anything already deployed. Stopping a build cannot reverse an external action that has already happened. Pausing an existing live service remains a separate control.

**Deployment succeeds but connecting the component fails.** Keep the new service inactive and available for a retry. Remove abandoned setup resources after a defined grace period so failed work does not leave running computers or unexpected costs.

**A new release fails.** Continue serving the previous verified release. Store which release each published component uses, and test a replacement against that component before changing its connection. Returning to an earlier code release must also be safe for the current saved records; it does not rewind those records. This tracks deployed code versions; it does not introduce alternative PVO formats or legacy parsing paths.

**A creator presses Undo.** Undo can restore the component edit. It cannot unsend a message or reverse a reservation. A cancellation is a separate operation with its own result. Keep enough service ownership information to manage resources after a component is removed.

**A connection expires or a usage limit is reached.** Show the problem in the creator's existing status surface, retain the unresolved state, and provide a way to reconnect or adjust the limit. Viewers get a short, accurate explanation.

**The creator pauses or deletes a service.** Show which published components will be affected. Pausing stops new work while preserving records; deletion follows an explicit retention rule. Deleting a local component alone must not silently break services still used by published videos.

The service record should also retain its source, release history, connection references, recent results, and spending limits. That lets the agent repair an existing feature instead of rebuilding it from scratch every time.

## How this fits the current Restyle codebase

These are proposed responsibilities. They should be introduced as working features with tests, rather than empty folders.

| Existing area | Proposed responsibility |
| --- | --- |
| Editor assistant features | Conversation, follow-up questions, connection setup, task progress, and applying the finished component through existing commands. |
| Editor domain code | Pure rules for validating a prepared component change and checking that the project has not changed underneath it. |
| Server assistant service | Planning and coordinating research, workspace tools, questions, and resumable tasks. |
| Focused server services | Workspace management, deployments, the connection vault, saved jobs, and routing viewer requests. |
| Shared packages | The agreed shapes of requests and results used by editor, player, and server. |
| PVO compiler and runtime | Component validation, checked events, approved request hosts, and the supported presentation of results. |
| Standalone player | Run the same connected component without depending on editor code. |

Generated creator services should be stored and deployed as separately owned services. Creating a dinner component should not rewrite or redeploy Restyle's main application. Shared packages remain independent of editor, player, and server internals.

The historical foundation used Cloudflare's [native container API](https://developers.cloudflare.com/containers/api/durable-object-container/) for temporary Linux workspaces and [Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/) for isolated JavaScript service execution. The [infrastructure proof](restyle-cloud-infrastructure-proof.md) passed in the actual Workers Paid account after the workspace deployment was deleted. Saved tasks, independent validation, ownership and service management now exist on the implementation branch; the [current progress](restyle-cloud-agent-progress.md) records current provider and beta acceptance. These facts do not prove hosted Node.js readiness. 1G replaces the generated-service execution adapter while retaining the existing platform controls. On 7 October the user selected **Fly.io** for Node execution; its isolated Machines proof is [recorded separately](restyle-node-provider-proof.md). This does not move the existing task runner, durable records or workshop provider, and its successful isolated proof does not by itself establish final product/beta acceptance.

The next product runtime is **JavaScript/Node.js in hosted Containers**, as requested. Use a pinned platform runtime and immutable checked service bundles, with durable records outside the guest. Replace the current generated-service runtime contract in one coordinated change; do not retain dual runtime fallbacks. Other languages and providers remain future work.

The existing [architecture](architecture.md), [orb assistant design](orb-assistant.md), [publishing setup](cloudflare-publishing.md), and [release workflow](environments.md) remain the references for current behavior. Changes to the platform itself follow the repository's normal release process.

## A sensible way to build it

**First: prove a complete path.** Let a signed-in creator ask for a component that needs a small new backend. The agent saves a task, writes the backend in an isolated workspace, tests it, deploys it, and connects a real PVO request. Include task ownership, basic questions, server-enforced test operation, spending limits, and controls to inspect, pause, or delete the service from the start. Verify it in both Try and a published player. The service must still work after closing Restyle and shutting down the workspace.

A dinner RSVP could be one test, but the agent must also handle a different example, such as a shared equipment request, using newly generated logic. That demonstrates a general building capability rather than a single hard-coded restaurant feature.

**Next: deliver Containers using the same service system.** Add the saved code editor and AI continuation, replace generated execution with checked Node.js hosting, and complete basic update/management work pulled forward from Roadmap 4. Verify draft, release and record survival after the workshop and hosted instance stop. Follow [1G](restyle-cloud-agent-roadmaps/1g-containers.md).

**Then: broaden the connections and setup experience.** Add more service connections, richer resumable questions, and an agreed manual alternative. Secure account setup is required as soon as an external account is used. Test that expired connections and missing answers lead to a useful next step.

**Then: support slower workflows.** Add saved viewer jobs, external event notifications, scheduling, and player controls for pending work and changing results. The saved authoring task that runs the build is already required in the first implementation.

**Finally: deepen diagnosis and expand capabilities.** Reuse the update, cost and management controls delivered in 1G. Add diagnosis of real account/job failures, operational monitoring, richer controls and runtimes beyond Node.js when concrete tasks require them.

Test failures as part of the complete path: closing the editor during work, restarting the workspace, losing provider access, pressing twice, updating a published component, and failing after an external action may already have happened.

The first release is ready when a creator can ask for a new working feature, answer only the necessary questions, try it safely, publish it, and later manage the service that makes it work. Claims of successful messages, reservations, or other external actions must come from the actual service result.

## Implemented research and saved choices

See the [2A research contract](restyle-research-contract.md) for public documentation research, credential-free account inspection, saved choices, independent research during questions, and the remaining secure setup/provider effects in 2B/2C. These extend the existing saved task and start no workshop.

## Connected Container execution — 2C implementation

The [connected Container contract](restyle-connected-services.md) extends the existing service host and account owner. The isolated Node code asks for a named action; trusted code checks the checked version’s approval, account scope and permission before attaching credentials. Results pass the declared schema before returning to a fresh Node instance. Normal Try and independent cases use saved examples. A durable receipt precedes an outside write; an uncertain outcome remains available for inspection without repeating that write. [Roadmap 3 background work](restyle-background-work.md) now adds durable jobs and receipts through this same service owner, plus signed Resend callbacks, bounded owned-receipt checks and saved schedules. The progress log separates controlled acceptance, real provider evidence and beta delivery.

## Agent identity and account setup — authorized extension

[Roadmap 5](restyle-cloud-agent-roadmaps/05-agent-identity-and-onboarding.md) resumes creator-linked email and adds optional phone identity using AgentMail and AgentPhone. The existing owner object owns durable setup intent; the existing encrypted vault holds credentials. Workshops and viewer execution receive no platform credentials. Identity, provider accounts and records survive workshop shutdown. The model receives safe status and approved capability references. Provider bootstrap, verification, third-party signup, API-key capture and checked Container attachment are separate verifiable steps. Existing service/network/owner boundaries remain; no permanent per-creator VM or PVO Logic privilege is introduced.
