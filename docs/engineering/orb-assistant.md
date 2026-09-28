# Orb assistant

The editor's orb proposes changes to the selected Tooltip, Card, Choice or Form. It is available outside Try mode and timeline pickers, including the desktop component inspector and the expanded Advanced IDE. Normal phone component sheets hide it. Without a selection, the plain orb asks the user to select a component. Selecting one adds a violet ring. Opening the assistant pauses playback without moving the playhead or resizing the preview, transport or timeline. Closing or keeping restores the previous playback state in the same editing scene.

Expanding Advanced places the existing assistant inside the black source surface using a portal; it does not mount a second session. Its floating controls stay within that surface and participate in the desktop focus scope. The header, navigation and source controls pause individually during input and review, leaving the nested assistant interactive. The source surface reaches the panel bottom, and its scroll padding lets the last code line move above the orb and phone safe area. Collapse restores normal placement; pending work or review must be resolved first. The source editor itself stays mounted across expansion and collapse.

The toolbar remains 100 px tall, plus the bottom safe inset. Its normal buttons are unmounted while the assistant borrows that space; nothing is dimmed. Tap the orb to glide left and reveal the typing row with a miniature component colour cue, type and time. During review the orb moves to the centre and rises 14 px, with three follow-up chips beneath it and a centred proposal card above it. Glides take 420 ms, rows rise in 300 ms, and chips pop in 280 ms with a 50 ms stagger. Both system and app reduced-motion settings remove these animations.

## Ownership and review

| Area | Responsibility |
| --- | --- |
| `editor/src/features/assistant/` | Prop-driven views, placement, focus and session orchestration. `useAssistantSession` coordinates requests and stale-target checks. |
| `features/assistant/voice/` | Orb tap/hold events and one cancellable browser recognition session. |
| `packages/pvo-assistant/` | Shared request/response parsing, structured-output schema and compiled proposal policy. |
| `editor/src/domain/assistant/` | Review snapshots, bounded request context, failure classification and project-context validation. No React or store dependencies. |
| `editor/src/infrastructure/assistant/` | HTTP transport and exact-source PVO compilation. |
| `editor/src/state/assistant/assistantStore.ts` | Session-only `idle`, `typing`, `listening`, `working` and `review` state, transcript and Before flag. |
| `editor/src/state/assistant/assistantCommands.ts` | The single Keep command that writes the component through existing project history. |

Review renders a proposed component with a dashed violet outline and Proposed label without changing project data. Hold **Before** to show the original and Before label; release to restore the proposal. **Undo** or tapping the request returns the request and all refinement tags to the typing field. Follow-ups refine the current proposal while retaining the original comparison; the card reports changes across Style, Structure and Logic. **Keep** commits the complete result as one undoable component edit, including all follow-ups. Content, Look, Action and the validated PVO source update together; visual controls stay editable and Advanced remains optional under the [visual/PVO editing rules](../language/README.md#two-authoring-routes-one-component).

Only Keep, Undo or editing the request leaves review. On mobile, tapping outside the composer anywhere in the workspace closes typing or listening and returns to the main tools. Escape also closes typing or listening. These actions do not dismiss thinking or review. Enter sends from the input. Unsupported requests retain their wording and use the approved single top notification. Routine Keep success stays quiet, following the [notification policy](notification-policy.md).

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
npm run check:browser -- editor orb-assistant assistant-voice
```

Start the editor separately with `npm run dev:editor`; use its actual URL and the [browser prerequisites](../../scripts/README.md). The Node suite covers the shared contract, live-only transport failures, PVO/context validation, cancellation, review isolation and atomic Keep/history. Browser checks replace only the HTTP provider with explicit fixture responses while exercising the real compiler, review workflow, follow-ups, mobile layout and reduced motion. The voice check also injects a recognition double while exercising real gestures and app state; it does not verify live microphone access or transcription quality. Test those separately on target devices. Mocked provider checks do not prove deployed model availability; that needs a separate live request.

