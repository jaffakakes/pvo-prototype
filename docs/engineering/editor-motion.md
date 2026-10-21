# Editor motion

Opening a tool explains a change of focus. Editing a value follows input immediately.
Editor motion never changes the component's authored position, scale, opacity,
animation, timing, or exported result.

## Navigation rules

| Interaction | Behaviour |
| --- | --- |
| Open a tool panel | Controls rise into the lower workspace. Opacity, Transform, Crop, Speed and Animation hide the project header and fit the complete video into the recovered space. |
| Open component Design | Carry the selected component into the enlarged, centred component stage. |
| Open Timing or Cover | Carry the video into the shared full-screen frame picker. |
| Change tools within the same workspace | Briefly fade the controls. Keep the subject steady unless the new tool needs different space. |
| Open the phone assistant | The editor recedes to 96% with a 1.5 px defocus and a dim layer; the orb rises slightly. Keep that focus through processing and review. Before comparison and the conversation restore the video so it remains usable. |
| Minimize processing | Tapping the background restores the clear editor and its bottom toolbar while the request continues. The orb pulses above the toolbar at the side; tapping it restores focus. Tapping the focused orb stops the request. Reduced motion uses a static busy indicator. |
| Close or return | Reverse the focus transition and restore the previous workspace. Keep each view's close control anchored. |
| Drag, scrub, type or adjust a value | Update directly. Do not replay navigation, introduce easing behind the pointer, or add history entries for UI motion. |
| Repeat or interrupt navigation | Do not queue animations. A new navigation supersedes the previous visual; its command still runs. |

Fit the complete video; do not crop it for a UI transition. The component's
position within its video remains meaningful during Opacity and Transform.
Only Design isolates the component.

## Shared implementation

`editor/src/ui/motion/editorMotion.css` owns the timing and easing:
240 ms for tools, 180 ms for closing, 300 ms for a focus change and 120 ms for
switching controls. Arrivals decelerate without bounce.

`EditorMotionProvider` owns browser View Transitions and their cleanup.
Component tools, Design return, Cover/Timing and shared sheet dismissal use
that provider. Shared-element names are active only during navigation.
Workspace layout and ordinary sheet entrances use the same CSS tokens.
`useToolSwap` fades only when the active tool changes, never when its values
change. Do not add an independent entrance animation to those same elements.

Browsers without View Transitions still execute the same commands. Panels
retain their CSS transition, and unsupported full-screen transitions use the
existing layout directly. Motion is not a dependency of saving or navigation.

## Reduced motion

**Reduce motion** lives beside **Advanced edits** in the project dropdown and
uses the existing device preference, outside project history. It persists in
local storage. Either this setting or the system's reduced-motion preference
removes shared-element movement and zoom; navigation uses an 80 ms fade.
The assistant keeps a short dim fade without shrinking, blur or orb movement.
Direct manipulation and authored video animation remain separate.

## Verification

`npm run check:browser -- editor editor-motion component-selection cover-picker`
checks the reference transitions, reverse navigation, live controls,
interruption, light/dark layouts, persistence, system preference and missing
View Transitions support. The Cover suite also checks Save/cancel and reload.
Browser tests exercise isolated projects, not the user's active editing session.
