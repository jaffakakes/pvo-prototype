# Editor corners and elevation

Shape communicates what an element does. Keep the same roles in light and dark
themes, at every screen size. The shared values live in `editor/src/theme.css`;
feature styles choose a role instead of introducing another radius or shadow.

## Corners

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Small detail | `--radius-small` | 8 px | Small thumbnails, labels, rectangular slider handles and inset controls. |
| Control | `--radius-control` | 12 px | Buttons, fields, toolbar tiles and the outer filmstrip. |
| Card | `--radius-card` | 16 px | Media previews, content cards, style samples and segmented-control containers. |
| Floating panel | `--radius-panel` | 24 px | Popovers and dialogs; only the exposed top corners of bottom sheets. |
| Round | `--radius-round` | Fully round | Playback, avatars, the assistant orb, colour swatches, switches, radios and status dots. |

Nested controls use a smaller role than their container: a 16 px segmented group
contains 12 px buttons. Media samples are rounded rectangles, not circular crops.
The Opacity handle stays rectangular, as designed.

Straight edges remain at adjoining workspace panels, full-screen page boundaries,
list separators and timeline measurements. A docked sheet joins the workspace
without an additional floating frame. Tiny playhead and icon geometry keep their
purpose-specific shape; they are not buttons or cards.

## Elevation

| Role | Token | Use |
| --- | --- | --- |
| Flat | `none` | Fields, media windows, list rows and choices within a group. Use fill, border or an underline for selection. |
| Raised control | `--shadow-control` | 3 px hard offset for standalone Back, Close, Save, Sign in, Use and tool-launch buttons. |
| Pressed control | `--shadow-pressed` | 1 px remaining offset for controls with an existing pressed treatment. |
| Floating panel | `--shadow-floating` | 6 px accent offset for detached menus and dialogs. |
| Bottom overlay | `--shadow-sheet` | Upward offset for an overlay sheet; omit it for a flush dock or an in-page section. |

Retain Restyle's outlined, hard-offset style. Do not mix a soft blurred shadow
into one menu or add a shadow solely because an option is selected. The detached
phone assistant input uses `--shadow-control` to separate it from the timeline
beneath it. Focus rings are separate from elevation. Bare transport icons, inline links and row actions
stay flat.

## Applied surfaces

The shared roles cover the editor header and toolbars, component Design tools,
Opacity/Transform, main preview, Cover/Timing, shared sheets, ratio and sound
menus, project/account menus, sign-in controls and export controls.

Cover and Timing use the same `FramePicker`: rounded video window and filmstrip,
rounded exposed footer corners, and raised Save/Close buttons. The filmstrip's
individual frames remain adjoining rectangles and its time marker remains precise.

These are editor presentation rules. They do not change authored component
corners, video dimensions, exported pixels, selection or history.

## Verification

Inspect light/dark phone layouts, a small phone and desktop in one visual pass.
Check that control shadows and focus rings are not clipped and that rounded
media windows preserve aspect ratio. Existing `cover-picker`, `component-page`,
`component-selection`, `project-settings` and `sound-browser` browser checks cover
the affected interactions. No new runtime abstraction is needed for these roles.
