# Notification policy

**Approved on 27 September 2026.** This is an active editor coding standard. The user approved short coloured notifications that animate down from the top, with × dismissal, and removal of excessive routine feedback.

## Quiet by default

Default to quiet feedback. A visible result is usually enough: a component appearing, a clip splitting, a selection changing or the toolbar returning already confirms the action.

**Revised presentation, following the user's feedback:** notifications slide down from the top of the app, below the phone's safe area. Each is a compact coloured message with an **×** on the right. Do not place notification text beside the assistant input. Short wording is the immediate priority.

Use one notification per event, not an inline message plus a banner. Keep the existing limits on unnecessary confirmations; adding a success colour does not mean every successful action gets a message.

## Appearance and copy

| Type | Colour and icon | Example |
| --- | --- | --- |
| Error | Red, error icon | “Request not supported.” |
| Success | Green, check | “Export ready.” |
| Warning | Amber, warning icon | “Hold a little longer.” |
| Information | Blue, info icon | “Voice unavailable.” |

Use a compact tinted surface or colour accent with readable text. Pair colour with the icon and wording, so colour is not the only signal. Put a clearly visible × beside every message, with a comfortable touch target and an accessible “Dismiss notification” label.

Aim for **3–6 words**, with a maximum of **50 characters** for banner copy. No paragraphs, raw exceptions, lists of supported AI commands, filenames or technical details. Allow wrapping on narrow screens instead of clipping; the copy should still be brief. Detailed diagnostics can remain in the existing feature's detail view, without a second notification.

## What the original audit found

- The assistant sent the same error to its inline status and the global toast. The screenshot showed an unsupported local-preview request reported twice.
- All global messages shared one string and a **1.6-second timer**. A new message replaced the previous one without distinguishing a routine confirmation from a save failure.
- The toast was positioned at 45% of the app height, with `white-space: nowrap` and no maximum width. Long messages ran off-screen and covered the working area.
- Routine actions such as sound selection, timer changes, splitting, adding components and keeping a proposal generated confirmations that duplicated visible changes.
- Save, restore and footage failures used the same brief toast and lost their visible status when it expired.

## Which kind of feedback to use

| Situation | Proposed treatment | When it appears / ends |
| --- | --- | --- |
| Successful immediate edit or setting change | **No toast.** Use the changed component, timeline, icon, selected state or existing Undo control. | The action itself supplies the feedback. |
| An assistant request or attempted operation cannot proceed | **Short error notification sliding down from the top**, with ×. Preserve the user's input. | After the failed attempt; no duplicate beside the input and no message on every keystroke. |
| A brief gesture needs correction | **Short warning notification**, using the same presentation. | Only after the unsuccessful gesture; no more than once per 10 seconds. |
| An operation is running | **Local progress state** on its button, component or panel. | While that operation is running; ends when it completes or fails. No separate started/completed toasts. |
| Work could be lost, could not be restored, or a recording failed | **Short persistent error notification**, with × and an accessible recovery path. | On failure; stays until resolved or explicitly acknowledged. Dismissing the banner does not mark the problem resolved; retain its status in the relevant feature. |
| An allowed brief event has no better home | **One compact toast**, following the rules below. | Only for an allowlisted event. |

## Allowed reasons to notify

The following are approved triggers, not permission to notify after every action:

| Event | Suggested copy | Conditions |
| --- | --- | --- |
| A requested split cannot be made | “Move the playhead inside a clip.” | Only after the Split command fails. No message on selection, scrubbing or hovering. Deduplicate repeated attempts. |
| Flash fails unexpectedly on the current camera | “Flash unavailable.” | Only after the user attempts it. Once the limitation is known, stop repeating the notification for that camera session. |
| AI, voice, import, export or Try action fails | A short error or warning from the copy catalogue | Only after the relevant attempt, once. Preserve input; do not print the full exception. |
| Save, restore or recording fails | A short persistent error | Never silently dismiss unresolved work-at-risk errors. |

No routine success toast is approved. A future background-completion toast, such as “Export ready”, would need an explicit catalogue entry and must only appear when the user is away from that operation's status panel. Do not add that event now: the current Export panel already shows completion.

## Strict display and timing rules

1. **One event, one message surface.** Never show the same error inline and as a toast. A retained status indicator may link to details; it must not repeat announcements.
2. **No arbitrary messages.** Agents must use an approved event catalogue with a trigger, scope, destination, copy and dismissal rule. New global toast events require review; calling `notify(error.message)` is not an acceptable shortcut.
3. **One global toast at a time.** No stack or backlog. Deduplicate by event and operation, not just the text. Allow at most one noncritical toast in 10 seconds; drop repeated or stale messages instead of replaying them later.
4. **Four seconds for a brief notification.** Pause its timeout while hovered or keyboard-focused. Every message has × dismissal. Work-at-risk errors remain until resolved or acknowledged.
5. **Protect concentration.** Do not show unrelated noncritical notifications while recording, dragging, trimming, typing, listening or reviewing an AI proposal. A short failure notification for the user's current attempt may appear; do not suppress it merely because the input remains focused. Do not replay a backlog later.
6. **Short, bounded copy.** Aim for 3–6 words, at most 50 characters and two visible lines. Fit within the app width with at least 16px side margins. No horizontal strip stretching beyond the screen.
7. **Top placement.** Animate down into a compact top-of-app notification area, below the safe inset. Keep the input and bottom toolbar clear. Avoid obstructing essential controls, and keep the message footprint small.
8. **Quiet motion and accessible status.** Use a quick downward slide with a subtle fade, no bounce or sound. Respect reduced motion, do not steal focus, and announce each event once. Pair colour with an icon and text.
9. **Follow the current operation.** Clear irrelevant messages when their component, scene or workflow is left. Discard responses from cancelled or superseded attempts. Project-save and recovery warnings remain project-scoped until resolved.
10. **Tell the truth.** Use “Ready to download” when the file has been generated; the browser starting a download does not prove it was saved to the phone. Never show success when recording, saving or exporting failed.

## Audit: approved treatment of messages

Rows group repeated toolbar, keyboard and sheet entry points for the same operation; those entry points must use the same policy.

| Previous event / messages | Required behaviour | Source |
| --- | --- | --- |
| Component added: “Added — drag to place” | Remove the toast. Selection and the new component confirm insertion. Put placement guidance in contextual help, not every insertion. | [Picker](../../editor/src/features/component-authoring/Picker.tsx) |
| Component duplication/deletion; text deletion | Silent result; retain normal Undo. No celebratory or confirmation message. | [Tool row](../../editor/src/features/timeline/ToolRow.tsx), [keyboard](../../editor/src/app/useEditorKeyboard.ts), [component editor](../../editor/src/features/component-authoring/fields/EditorSheet.tsx) |
| Clip split/deleted; camera “Last clip removed” | Silent on success; only a failed split uses the allowlisted guardrail toast. | [Clip commands](../../editor/src/features/timeline/clipCommands.ts), [Camera](../../editor/src/features/capture/Camera.tsx) |
| Scene created; empty scene removed after cancelling recording | Silent. The scene row or return to the previous scene shows the result. | [Outcome editor](../../editor/src/features/component-authoring/outcomes/OutcomeStep.tsx), [scene actions](../../editor/src/state/scenes/sceneActions.ts) |
| “Reset to fields”, “Cleared”, “Nothing to discard yet” | Silent completion after existing confirmation. Disable an unavailable action or explain it locally. | [Component editor](../../editor/src/features/component-authoring/fields/EditorSheet.tsx), [session actions](../../editor/src/state/project/sessionActions.ts), [Camera](../../editor/src/features/capture/Camera.tsx) |
| Flash on/off, timer setting, clip audio on/off, sound name | Remove success toasts. Use the control's selected state, icon, badge or label. Unexpected flash failure follows the allowlist. | [Camera](../../editor/src/features/capture/Camera.tsx), [Timeline](../../editor/src/features/timeline/Timeline.tsx), [Sound sheet](../../editor/src/app/Sheets.tsx) |
| Orb shortcuts: “Paced up”, “Title added”; assistant “PVO change kept” | Remove toasts. The changed timeline/component and return to normal tools confirm the result. | [Tool row](../../editor/src/features/timeline/ToolRow.tsx), [assistant session](../../editor/src/features/assistant/useAssistantSession.ts) |
| No clip available for a component, or an empty scene destination | Explain in the component picker / Try status with the affected scene. Do not emit a global toast every time. | [Picker](../../editor/src/features/component-authoring/Picker.tsx), [Try mode](../../editor/src/features/preview/tryMode.ts) |
| Unsupported AI request, provider/compile/context failure, stale target | One short top notification with ×. Keep the request for refinement where applicable. Do not repeat the error beside the input or notify for a stale response in an unrelated screen. | [Assistant session](../../editor/src/features/assistant/useAssistantSession.ts) |
| AI logic needs Advanced while the switch is off | “Enable Advanced for this logic change.” — one short information notification for the attempted change. Preserve request text, project and history. Appearance edits do not trigger this event. | [Assistant mode guard](../../editor/src/domain/assistant/editingMode.ts) |
| “Hold a little longer” | Short amber top notification, with × and the repeat limit above. | [Orb gestures](../../editor/src/features/assistant/voice/useOrbVoice.ts) |
| Speech unavailable, permission denied, no speech, network/startup failure | One short coloured top notification. No duplicate input message. Cancellation itself is silent. | [Recognition session](../../editor/src/features/assistant/voice/recognitionSession.ts), [voice errors](../../editor/src/features/assistant/voice/browserRecognition.ts) |
| Import pending / “Couldn't read that file” | Local import progress; one persistent result listing failed files and any successful imports. Successful clips appear silently. Do not overwrite one file's failure with the next. | [Camera import](../../editor/src/features/capture/Camera.tsx) |
| “Couldn't save the footage — blank clip added” | Persistent recording/clip failure, identifying the affected clip and explaining that it needs recording again. Do not present the placeholder as successful footage. | [Recorder](../../editor/src/features/capture/useRecorder.ts) |
| “Couldn't save project”, “Couldn't restore saved project” | Persistent project status with recovery controls. Healthy autosaves do not produce toasts. | [Autosave](../../editor/src/app/projectAutosave.ts) |
| Export error / “Export failed” | Short error notification; retain Retry and useful details in Export without repeating the banner text. Keep existing progress and completion UI. | [Export](../../editor/src/features/export/ExportSheet.tsx) |
| “Sending request…”, “Request complete”, “Request failed — try again” | Status on the affected component / Try interface. Success is silent when the authored action shows it; otherwise local status. Respect authored error routes. Never automatically resend a request as part of notification handling. | [Try mode](../../editor/src/features/preview/tryMode.ts) |
| Try initialization error; “PVO: …” runtime errors | Persistent local component/Try error, deduplicated by component and cause, with details. Do not duplicate source-editor diagnostics. | [Try mode](../../editor/src/features/preview/tryMode.ts), [PVO preview](../../editor/src/features/preview/PvoRuntimeOverlay.tsx) |

## Example: the screenshot

**Before:** the same long unsupported-request explanation appeared as a wide toast and beside the assistant input.

**Now:** a compact red notification slides down from the top: **“Request not supported.” ×** There is no duplicate message beside the assistant input. Keep the request editable and use “PVO assistant” as the mode label. Supported examples belong in help/suggestions, not a long error banner.

Other copy examples:

| Situation | Message and location |
| --- | --- |
| Too-short voice hold | “Hold a little longer.” — amber notification, × |
| No speech captured | “Didn't catch that. Try again.” — amber notification, × |
| Microphone permission denied | “Microphone access denied.” — red notification, × |
| Export failed | “Export failed. Try again.” — red notification, × |
| Browser project save failed | “Couldn't save changes.” — persistent red notification, × |
| Project restore failed | “Couldn't restore your project.” — persistent red notification, × |

## Existing feedback to preserve

Keep camera permission/startup UI, recording/countdown, clip-replacement and scene context, Try/HOLD indicators, export progress/completion/download, language checking/diagnostics, field/URL/domain validation and existing destructive confirmations. These communicate an actual state or decision; they should not also generate toasts.

Keep the existing update workflow. Adding new update access or recovery screens is deferred; the immediate review concerns concise notifications, their appearance and excessive repetition.

## Implementation ownership

The notification host renders one compact top banner and retains acknowledged critical issues behind an issue control. That control appears after dismissal, or when another critical issue also needs attention. Healthy editing adds no notification chrome.

Camera and More expose import results and recording recovery when a problem exists. Failed files can be retried together; failed recordings have a Record again action. A video-only camera fallback has a local microphone status. These states do not imply that missing footage was captured.

Storage failures appear as short top toasts, never as a panel pinned below the camera. Detailed recovery controls appear only when the user opens the retained storage issue or More. Writes are gated behind successful restoration. Retry cannot hydrate over new session work or overwrite the unread saved checkpoint. New edits arriving during recovery block hydration; the user can export current work before reloading. Healthy autosaves remain silent.

Export retains Retry and collapsed details; its banner is scoped to the active Export workflow. Try requests expose pending/failure status on their component and honour authored error routes without another global toast. Component rendering failures have local details; source diagnostics remain in the code editor.

Verification must cover quiet ordinary edits, single AI error reporting with retained input, mobile safe areas, keyboard dismissal, pause/expiry, repeated-event suppression, durable failure recovery, and unchanged Undo/request/sandbox behaviour. Browser checks use mocked voice/storage failures where applicable and do not substitute for real-device microphone testing.

The [catalogue](../../editor/src/domain/notifications/catalog.ts) owns approved event IDs and copy; the [policy](../../editor/src/domain/notifications/policy.ts) owns priority and repetition rules. The [notification store](../../editor/src/state/notifications/notificationStore.ts) coordinates ephemeral notices and retained issues. The [notification feature](../../editor/src/features/notifications/) owns presentation, timing and browser interaction. Feature owners retain diagnostics and recovery actions. Do not reintroduce free-form `notify(message)` or create a second toast system.
