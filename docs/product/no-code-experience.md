# No-code component editing

Implemented from the supplied `NO_CODE_EDITOR.md` proposal. The earlier [design brief](claude-no-code-design-brief.md) remains background material. This page describes the current editor; format syntax belongs in the [language guide](../language/README.md), and code ownership belongs in the [architecture](../engineering/architecture.md).

## Editing flow

**Components** opens four starters at the playhead: Add a note, Show a message, Let viewers choose, and Ask for details. A new component starts with the Bold appearance and opens **Content**. Their PVO kinds are `tooltip`, `card`, `choice`, and `form`.

The component sheet has **Content**, **Look**, and **Action**. Timing appears under Content. More enables an optional **Advanced** tab; it is off by default. Opening the sheet replaces the timeline at its current height. Dragging the divider changes the sheet height while keeping the video and playback controls visible. Internal scrolling never changes the divider height. Closing or pulling down restores the timeline. Native keyboard viewport changes expand the sheet and hide its tabs until editing finishes.

The header contains Undo, Redo, Try and More. Editing taps select; viewer actions only run in Try. Try hides the lower region and Stop restores the scene, playhead, selection, tab and sheet height. Space controls playback, T enters or leaves Try, Escape closes the sheet, and Delete removes the selected component. Text inputs retain normal typing shortcuts.

## Content and timing

- Notes have no viewer action. They may display text or a value already stored in playback state, including a GET or POST response.
- Messages have a title, body and up to two buttons.
- Choices have exactly two options with independent outcomes.
- Forms have a heading, submit label and one to five named fields. Each accepts Text, A number, or Yes / no.

Forms default to a local Continue action. **Collect replies** in Action creates a Restyle reply box and sends the viewer's answers there; creators read them in **More → Replies**. Choosing it on an untouched Form starter changes the prompt to “Send me a message” and leaves customized forms intact. Try simulates a successful submission without saving a reply. This first-party action does not send automatic email. Custom HTTP requests still require Advanced Logic and a configured destination. The sending label lasts for the actual request; success follows a successful response and failure follows a failed response.

All component types expose Appears at, Pick on timeline, Use current playhead and Shows for (3s, 5s, 10s or Until clip ends). Messages, Choices, and Forms have two independent Action settings:

- **Run response** chooses When selected/submitted or At layer end. At layer end remembers the response locally; it does not run Logic or start a request early.
- **If nobody responds** chooses Keep playing or Pause and wait at the layer end.

Continue, a time jump, a scene route, and a request all follow the same response timing. Branching is therefore an outcome, not another name for answering. Placement uses the existing drag-on-video gesture.

| Component | What counts as a response | Runtime state written at dispatch |
| --- | --- | --- |
| Note | Nothing; it is display-only | None. It may read existing state. |
| Message | Tapping one of its buttons | The selected button runs its action. |
| Choice | Selecting an option | `state.choices.<component-id>` stores the exact option index. |
| Form | Submitting valid fields | `state.form.<component-id>` stores the submitted values. |

| Viewer state at layer end | Run response right away: On | Run response right away: Off |
| --- | --- | --- |
| Responded | The action already ran. Playback does not wait just because it is still finishing. | The latest response runs now. |
| No response + Pause off | No action is invented; playback continues. | No action is invented; playback continues. |
| No response + Pause on | Playback waits for a response. | Playback waits for a response. A late response runs immediately because the boundary has been reached. |

A successful GET or POST result is stored at `state.responses.<component-id>`. A Note can insert that path from Content and name a scalar response field, such as `{state.responses.component-1.message}`. Missing, null, object, or array values render as blank. Answers and requests never route playback by themselves; only an explicit Continue, time jump, or scene action determines what plays next.

## Appearance

Bold, Soft, Minimal and High contrast previews use the component’s current wording. Presets change appearance only: content, control count, outcomes, timing and placement survive. Reset appearance returns to the remembered base preset.

Select Whole, Heading, Body/Fields or an individual button through labelled chips or a tap on the video. Supported controls are colours, size, weight, alignment and corners. Swatches include a custom hex/hue/lightness picker and transparent fill/border where supported. Headings use Peace Sans; other text uses Open Sauce. Existing standalone text tools retain their separate capabilities.

Visual values are typed, normalized and shared between preview and player. They survive history, duplication, checkpoints and interactive export.

## Actions and Advanced

Each button or choice option can Continue video, Jump to a point, or Go to a scene. A routed scene becomes the rest of that viewing path; playback ends there unless another explicit action routes again. Timeline picking restores the same action chooser; Cancel restores the original playhead too. Form Action also offers Collect replies with a creator inbox and a configurable playback route after a successful send. Other requests, including their success and failure actions, are authored in Advanced Logic.

Advanced shows generated Structure, Style and Logic. Taking over with code makes Content and Look read-only. Action and timing remain editable. Returning to visual editing requires an explicit confirmation, resets appearance to Bold, and retains an independent source archive available through Use saved code. Turning Advanced off hides the tab without deleting source.

A valid source edit updates the fields projection and runtime. Action edits preserve unrelated Structure, Style and unfinished code. If the selected Logic event itself cannot be edited safely, the editor explains the problem instead of silently ignoring the change or replacing the draft. Form source supports optional headings, field labels, number inputs and a sending label.

## Persistence and export

One text focus session or continuous colour gesture creates one undo entry. Project history is 40 entries deep and survives scene navigation. Layout and tab preferences do not enter project history.

Visual components export through native PVO controls with `restyle_capture` appearance and form metadata. Code-owned components package their source and use the isolated compiled renderer. Both routes retain checked outcomes and destinations. Interactive `.pvo` carries the components; flat video omits them.

Collect replies uses an ordinary PVO POST to the Restyle reply box created when the creator enables it. The destination travels with a downloaded `.pvo`, so a viewer can submit from another player that permits the declared request host. The inbox is stored by Restyle, outside the video file; deleting the box stops collection for any exported copies that reference it. Replies are untrusted viewer input and bounded. Each box and its replies are deleted 180 days after setup. Try never sends one.

Routine edits are quiet. The repository’s [notification policy](../engineering/notification-policy.md) takes precedence over the proposal’s routine success-toast examples. The reserved Ask AI chip is not required for this flow; the existing assistant remains a separate feature.

## Verification

- `npm run check`: domain, history, persistence, request and export regressions.
- `npm run check:editor`: strict TypeScript.
- Native language tests, rustfmt, WASM build and language/runtime browser contracts verify the extended form grammar and sandbox.
- `npm run check:browser -- editor no-code-components no-code-workspace no-code-action-editing look-contracts`: the complete create/style/action/Try flow, source ownership, form submission, player appearance and 320/390/430px geometry.

Keyboard checks simulate visual viewport changes; a physical device keyboard remains a separate manual check. No live third-party service is required for tests: request checks use controlled responses.
