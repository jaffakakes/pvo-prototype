# Desktop editor

The approved `design_handoff_web_editor` reference replaces the earlier desktop bottom-strip design. The new layout applies at **1024px or wider in landscape**. Narrower and portrait viewports keep the existing mobile workspace. Resizing changes presentation, never the route or project identity.

## Presentation and ownership

`features/desktop-editor/DesktopEditor.tsx` composes a 56px header and four regions. Library widths are 480/420/360px and Inspector widths 360/340/320px at the 1440/1280/1024 breakpoints. The player takes the remaining width. The bottom timeline is 272px, clamped on shorter/tablet screens. Each panel owns its scrolling; short timeline layouts reduce gaps while retaining track heights.

- `library/` owns catalog navigation and media import adapters. Clip posters are real video frames from the shared `ui/media/ClipPoster`. Import stages and releases media through the existing project-media adapter. File drops are blocked during Try, assistant review, picking and modal/export workflows.
- `player/` owns scene navigation, playback controls and safe-zone presentation. The existing Preview, playback commands and Try runtime render and operate the project. Safe zones do not change exported media.
- `inspector/` renders selection-dependent controls. Its component frame reuses the same synchronized Content, Look, Action and optional Advanced workflow as mobile, including draft recovery and pixel dimensions. Schema controls translate interactions into existing commands.
- `timeline/` renders the four labeled lanes and owns pointer geometry. Clip/text timing transactions and selected-item commands live under `state/editing/`; split/trim constraints remain domain rules. Toolbar and desktop keyboard shortcuts use the same commands.

Project guides and timeline Snap use one presentation value. Library tab, timeline zoom and panel expansion are presentation state rather than serialized project fields. Named projects still use `/editor/?project=<localId>` and the existing IndexedDB checkpoints. Component width and height stay in authoring-canvas pixels, with a 1080px short edge, independent of preview size.

The existing assistant can open from the timeline while the component Inspector remains visible. Its proposal review still requires Keep before mutating the project. Project Inspector's More settings opens the existing preferences and request-domain controls. Advanced controls, export and settings retain the existing validation, request boundaries and recovery paths. Time picking replaces the timeline toolbar with shared Cancel/Use commands and temporarily makes other panels inert. No new account or AI backend is part of this layout change.

## Capability limits

The Media library contains Your clips and Samples; AI moments is omitted. The reference uses simulated processing results. Automatic captions, effects, transitions, sound effects and masks have no corresponding production pipeline in this beta and are explicitly unavailable. Existing clip fit/mirror/zoom/speed, text styling, synthesized music, components, scenes, real playback, history and export remain functional. Existing audio settings operate at scene level. Sign-in availability comes from the configured server; device export remains available when accounts are disabled.

The mock's routine edit toasts are superseded by the repository's [notification policy](notification-policy.md). Ordinary edits remain quiet and undoable.

## Verification

`npm run check:browser -- editor desktop-editor desktop-create component-size desktop-time-picker` covers panel geometry, shared routes, local projects/media, desktop edits, resize/save/reload, pixels, code-owned sizing, player geometry and time-picker acceptance/cancellation. `no-code-workspace` and `preview-gestures` retain coverage of the existing mobile view and touch behavior. Node tests cover insertion/history and timeline cancellation, with TypeScript and dependency checks validating module contracts.
