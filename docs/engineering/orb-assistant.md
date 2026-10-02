# Orb assistant

The orb opens **Restyle thread**, a session record of requests, pending work and kept component edits. It is available without a selection for reading history; sending a request still requires a selected Tooltip, Card, Choice or Form. It remains unavailable in Try mode and timeline pickers. Opening pauses playback, and closing preserves the selection and playhead while leaving playback paused.

Desktop shows a 440px popover above the toolbar orb. Phone replaces the lower timeline region with a resizable sheet: expanded starts at 480px, collapsed at 322px, with both clamped to leave room for the player. The orb rides its upper edge. Pulling below 120px closes it. Keyboard fitting uses the real visual viewport, temporarily shows the newest exchange, and restores the prior panel preference on dismissal. On small keyboard viewports, the outer editor header temporarily hides and thread labels compact to keep the compose field above the keyboard while preserving a 190px player; the full header and labels return when the keyboard closes. The compose field is the live voice caption; tap types, hold speaks and release sends. Desktop also has a microphone button.

The thread remembers its draft and collapsed state across openings. Closing a pending request leaves it running; reopening shows its status. Successful responses close the thread for the existing component review card, where **Keep** remains the only way to apply a proposal. Failed and cancelled requests remain in the record without claiming an edit. Refinements belong to their original proposal and one Keep history entry. There is no project-wide footage editing or proactive suggestion engine; the thread reflects the connected component assistant's actual capabilities.

Every kept row has **Undo / Redo** and **Show**. Undo applies a conflict-checked inverse of that exchange's changed component values as one normal history entry, preserving unrelated later edits. Overlapping later edits disable the action with an explanation. Global history updates the row's undone state. Show selects the target scene/component and reveals its timeline position without modifying history. Deleted targets cannot be restored by these controls.

The record is session-only: it survives closing the panel and changing component selection, but clears when the active project changes or the page reloads. It is excluded from project saves, exports and undo snapshots. The idle orb shows an exchange count. Both system and app reduced-motion settings remove animation.

Expanding Advanced places the same assistant inside the black source surface using a portal, with a compact thread bounded by that surface. Component review still floats above the orb and preserves the established Keep, Before and refinement controls. The source editor remains mounted across expansion and collapse.

## Ownership and review

| Area | Responsibility |
| --- | --- |
| `editor/src/features/assistant/` | Prop-driven views, placement, focus and session orchestration. `useAssistantSession` coordinates requests and stale-target checks. |
| `features/assistant/voice/` | Orb tap/hold events and one cancellable browser recognition session. |
| `packages/pvo-assistant/` | Shared request/response parsing, structured-output schema and compiled proposal policy. |
| `editor/src/domain/assistant/` | Review snapshots, bounded request context, failure classification and project-context validation. No React or store dependencies. |
| `editor/src/infrastructure/assistant/` | HTTP transport and exact-source PVO compilation. |
| `editor/src/state/assistant/assistantStore.ts` | Session-only `idle`, `typing`, `listening`, `working` and `review` state, transcript and Before flag. |
| `editor/src/state/assistant/assistantCommands.ts` | The single Keep command that commits a proposal. |
| `state/assistant/threadStore.ts` / `threadCommands.ts` | Session exchanges, project lifecycle, targeted inverse edits and selection navigation. |
| `domain/assistant/threadPatch.ts` | Pure changed-value comparison and atomic conflict checks. |

Review renders a proposed component with a dashed violet outline and Proposed label without changing project data. Hold **Before** to show the original and Before label; release to restore the proposal. **Undo** or tapping the request returns the request and all refinement tags to the typing field. Follow-ups refine the current proposal while retaining the original comparison; the card reports changes across Style, Structure and Logic. **Keep** commits the complete result as one undoable component edit, including all follow-ups. Content, Look, Action and the validated PVO source update together; visual controls stay editable and Advanced remains optional under the [visual/PVO editing rules](../language/README.md#two-authoring-routes-one-component).

Only Keep, Undo or editing the request leaves review. Outside click, Escape, the close button and the phone drag handle close the thread; pending work continues. Review still requires an explicit decision. Enter sends from the input. Unsupported requests retain their wording and use the approved single top notification. Routine Keep success stays quiet, following the [notification policy](notification-policy.md).

The Advanced switch restricts **AI logic only**, not wording or appearance. With Advanced off, new behavior must use Continue, Jump to a point or Go to a scene; existing advanced behavior stays unchanged. Custom PVO colours, typography, corners and other compiler-supported visual edits remain available. The request carries the selected mode, and both server and browser enforce the logic boundary. The editor checks it again before review and Keep using the current switch. Disabling Advanced discards a pending review that needs advanced logic while preserving the request text, component and undo/redo history. A blocked attempt shows only “Enable Advanced for this logic change.” Accepted changes still form one undo step. Enabling Advanced retains the assistant's existing request-domain and capability safeguards; it does not grant new network access.

Drafts, transcripts and unkept proposals are not included in project persistence or undo history. Keep checks that the same unchanged component is still selected in the same scene, then revalidates routes and times before committing. Target changes, unavailable editor modes and unmounting cancel the pending session; late responses cannot overwrite a different component.

## Live component assistant

The orb sends component-editing requests to same-origin **`/api/assistant`** by default. It is limited to the selected component's PVO Structure, Style and Logic; it does not edit footage or operate as a general assistant. The UI says **PVO assistant**. Unavailable, rejected or failed requests preserve the input and show one curated notification. There is no preset fallback or artificial thinking delay.

The Worker service owns model inference and availability. Assistant use has no login or signup dependency. `VITE_PVO_ASSISTANT_URL` can explicitly override the endpoint when starting Vite or building the editor; overrides must implement the same contract and pass the same browser checks. An HTTPS deployment should use an HTTPS endpoint or a same-origin relative path. Vite alone has no assistant backend: use a Worker development server or explicit development endpoint for live requests.

The deployed service uses the `AI` Workers binding with [`@cf/meta/llama-3.3-70b-instruct-fp8-fast`](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/) and schema-constrained JSON. Each inference has a 25-second deadline within a 50-second operation deadline; a compiler/policy rejection allows one repair. No provider account or client-side API key is needed. The `ASSISTANT_BUDGET` Durable Object permits at most 60 model attempts per UTC day across the beta, 20 per network address per day and four per minute. Repairs and failed inferences consume attempts. Daily state contains dated address hashes and counters, expires after the day ends, and never stores prompts or component source. These app limits are separate from [Cloudflare's account-wide AI allowance](https://developers.cloudflare.com/workers-ai/platform/pricing/).

Keep provider API keys on that server. `VITE_*` values are client configuration and must not contain secrets. The client sends no authorization header or browser credentials, rejects redirects and disallows credentials embedded in the endpoint URL. A separately hosted endpoint must allow the editor origin through CORS; server-side access control and provider credentials are the backend's responsibility.

## HTTP JSON contract

The adapter sends `POST` with `Content-Type: application/json` and `Accept: application/json`. Optional fields are marked with `?` below. Source strings contain [PVO Structure, Style and Logic](../language/README.md), with empty Logic allowed where the language permits it.

```ts
type Source = { structure: string; style: string; logic: string };

type Request = {
  componentType: "tooltip" | "card" | "choice" | "form";
  source: Source;
  prompt: string;
  editingMode?: "no-code" | "advanced";
  context?: {
    currentSceneId: string;
    duration: number;
    scenes: { id: string; name: string }[];
  };
};

type Response = {
  requiresAdvancedLogic?: boolean;
  source: Source;
  summary: string;
  tags: string[];
  followUps: [string, string, string];
};
```

The request includes the selected component's source, prompt and bounded playable-scene context, not video files or the whole project. A follow-up sends the current proposed source plus the new prompt and latest scene context. The response must be a successful HTTP status containing a JSON object. Unknown fields are rejected at every level: do not return HTML/JavaScript fields, compiled output, a `mode` field or a wrapper envelope.

The editor always supplies `editingMode`; omitted mode conservatively uses the no-code logic boundary. `requiresAdvancedLogic: true` lets a provider decline an advanced logic request while returning the original source. This is rejected before review, never applied as a partial edit. Appearance changes must not use this flag. The server returns HTTP 409 for the mode boundary without spending another model attempt on repair; the browser maps it to the single Advanced-required notification.

The prompt is limited to 2,000 characters; summary to 400; tags to six labels of at most 40 characters each; and each of the exactly three follow-ups to 120 characters. These text values must be nonblank. Each source section is limited to 20,000 UTF-8 bytes, matching the compiler. Context allows at most 100 unique playable scenes, including the current scene, with IDs up to 128 characters and labels up to 120. Duration must be finite and nonnegative. The browser includes the current scene first when bounding large projects. Context may be omitted for compatibility, but new or changed scene/time routes then fail validation. The live server additionally limits the serialized parsed request to 16 KiB before model inference and returns HTTP 413 for larger inputs; it does not truncate source.

Requests have a cancellable 60-second deadline including response decoding. HTTP 400, 413, 422, 429, 503 and 504 map respectively to rephrasing, input size, unsupported request, busy service, unavailable service and timeout notifications from the approved catalogue. Provider error bodies are never shown. See the shared [`pvo-assistant` contract](../../packages/pvo-assistant/index.js) and [`httpProvider.ts`](../../editor/src/infrastructure/assistant/httpProvider.ts).

## Validation boundary

The server and browser both validate the envelope, compile the exact proposed source and apply shared component policy before review. Invalid source is rejected rather than repaired by removing declarations in the browser. The component root must match the selected type; Restyle Choice proposals must retain exactly two options. PVO's restricted grammar remains authoritative: assistant output cannot introduce unrestricted HTML, CSS or JavaScript.

Compiler-valid actions are also checked against the current project. Scene routes must name nonempty scenes, and time jumps must stay within the selected scene's duration, including request success/error outcomes. These checks run before review and again at Keep. Preview rendering and host actions retain the existing sandbox and request-domain policy; configuring an assistant endpoint does not add it to component request permissions.

New assistant actions are limited to continue, jump to time and go to scene. Existing request actions must remain unchanged on the same event and target, including form field names and types used by request templates; new, changed or removed request effects are rejected. The compiler validates every Style property, selector and value. The complete-source response envelope remains compatible; the client derives the review's change counts from the original and validated proposed source.

## Voice input

A tap shorter than 320 ms opens typing or focuses the current input. Holding for at least 320 ms starts the available `SpeechRecognition` or `webkitSpeechRecognition` browser capability. Interim words appear live while held; release sends finalized recognition text directly to review preparation. Fewer than two words returns to the previous phase with the approved brief gesture warning. Cancellation, loss of the active pointer, page hiding and unmounting stop the attempt. Permission denial, unavailable microphones, no speech and recognition failures provide a typing fallback.

The browser controls recognition availability, microphone permission and its recognition service. The app supplies no speech backend and does not guarantee offline voice input or identical behaviour across browsers. Typing remains available when recognition is unsupported.

## Verification

Run from the repository root:

```powershell
npm run check
npm run check:editor
$env:EDITOR_URL = "http://127.0.0.1:5173/"
npm run check:browser -- editor assistant-thread orb-assistant assistant-voice
```

Start the editor separately with `npm run dev:editor`; use its actual URL and the [browser prerequisites](../../scripts/README.md). The Node suite covers the shared contract, live-only transport failures, PVO/context validation, cancellation, review isolation and atomic Keep/history. Browser checks replace only the HTTP provider with explicit fixture responses while exercising the real compiler, review workflow, follow-ups, mobile layout and reduced motion. The voice check also injects a recognition double while exercising real gestures and app state; it does not verify live microphone access or transcription quality. Test those separately on target devices. Mocked provider checks do not prove deployed model availability; that needs a separate live request.
