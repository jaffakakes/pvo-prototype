# Claude design prompt: creative no-code editing

Copy the prompt below into Claude. It is self-contained; the [product plan](no-code-experience.md) records the implementation boundaries in more detail.

---

Design and prototype the no-code component-editing experience for **Restyle**, a mobile-first interactive video editor. This is a visual design assignment; simulate the interactions without a live AI service or backend.

The user should feel creative and in control. They should be able to make an interactive video look like their own work through choosing, placing, styling and trying things. A long form of text inputs does not achieve that.

## Product direction

Keep the video central. Use one contextual bottom sheet with **Content**, **Look**, **Action**, and **Timing** tools, showing only what applies to the selected item. Decide how to arrange these tools without filling the phone with permanent navigation. Show one focused set of controls at a time.

The sheet is part of the layout: it replaces the timeline and its toolbar in the lower region. Dragging its compact handle upward grows the sheet and shrinks the player. Continue upward into fullscreen: progressively hide the player, playback controls and editor navigation as their space runs out. Dragging down restores them at the corresponding points. Do not cap upward travel to keep a tiny player on screen. Pulling fully down or closing restores the timeline with a smooth transition. Keep the draft and preview instance intact throughout. Scrolling controls within the sheet must not resize it. Timing pickers temporarily show the timeline and return to the same panel and draft afterward. Prototype these transitions, including reduced motion.

The default experience has no code. An optional Advanced editor is enabled through More → Advanced editing; it is off by default. Do not make enabling it part of the ordinary creative workflow.

The existing app has a video preview, timeline, text overlays, scenes and interactive components. Components can be dragged over the video and reordered in layers. It already supports undo, redo, duplication, timing and a Try mode.

## The main workflow to prototype

Use a realistic fashion-video example. The creator adds a Choice reading “Which look?” with two options, “Street” and “Evening”. They should be able to:

1. Choose the “Let viewers choose” starter and see it on their video.
2. Change the prompt and option wording.
3. Browse four visual looks, then personalise colours, heading size and corners.
4. Style the two options individually through a clear part selector.
5. Place the component and choose when it appears.
6. Set Street to open an existing “Street look” scene and Evening to continue the current video.
7. Try the interaction, return to editing, and undo a visual change.

Show meaningful differences between the looks using supported properties. A preset changes appearance only; it preserves wording, controls, actions, timing and placement. Every supported visual property remains editable afterward.

## Creative controls

- Component-specific design thumbnails: explore Bold, Soft, Minimal and High contrast as working preset directions.
- Colour swatches and custom colours for background, text and buttons/options, plus border colour where relevant.
- Heading/body/button size, supported font weights and alignment.
- Corner rounding.
- A clear selector for the whole component or its heading, body, button or option.
- Live visual feedback, accessible Undo/Redo, Duplicate, and a separate Reset appearance action.

Interactive components currently support these visual properties only. Do not show functional controls for font-family changes, shadows, image backgrounds, spacing, arbitrary layouts, animations, opacity, rotation or resizing. Whole-component placement is supported. Standalone text overlays have their own richer typography tools; do not accidentally remove those existing capabilities.

## Starter types and behavior

- Add a note: a display-only annotation, with no click action.
- Show a message: a card with a title/body and up to two buttons.
- Let viewers choose: exactly two options.
- Ask for details: a form using supported fields; submitting to a service requires a configured destination.

Use plain language for actions: Continue video, Jump to a point, Go to a scene. Pick existing scenes with labelled previews. Service requests belong in a secondary setup flow; do not invent automatic email delivery, analytics or integrations.

Editing taps select items. Try mode lets the creator use the interaction. Browsing designs must never trigger viewer actions or requests.

## Space and accessibility

Design at 390px and 430px widths and demonstrate a 320px layout. Keep the selected component visible while adjusting its appearance. An expanded sheet is allowed for focused work; avoid stacked permanent panels and toolbars.

Show the actual phone keyboard state for text editing. Account for safe areas, reachable Back/Done controls, at least 44px touch targets, visible focus, readable contrast and reduced motion. Provide an explicit placement alternative to dragging. Avoid hover-only or undiscoverable long-press actions.

For a component already controlled by Advanced code, show a clear read-only state and explain how to return to code editing or explicitly reset it. Turning off Advanced must never erase that code. Do not pretend every custom-coded design can be edited visually.

## Brand direction

Use the existing Restyle identity: dark background #0B0B0F, surfaces #15151C, warm white #F2F0E9, violet #A78BFA, pink #FF9FBC and teal #2EC4B6. Use Peace Sans for expressive headings and Open Sauce Sans for controls, or close fallbacks if unavailable. Preserve strong borders, rounded controls and the playful visual character.

Spend visual emphasis on the creator's video and design variations. Keep surrounding controls orderly. Use realistic copy and video placeholders throughout.

## Relationship to the planned AI assistant

Reserve a compact Ask AI entry point attached to the selected component. The no-code flow must be complete without AI. Do not add a permanent chat box. AI-generated changes will be previewed and explicitly applied later; this prototype should prioritise manual creative editing.

## Deliverables

Briefly compare two compact interaction layouts, choose one, then build an interactive prototype of the complete workflow. Include starter selection, Content with keyboard, Look presets, detailed part styling, placement/timing, Action selection, Try mode, Undo and a code-owned read-only state.

Explain any gesture or navigation decision that is not obvious. Annotate which controls reuse existing capabilities and which require new product work. New no-code styling is planned, not already implemented. Interactive PVO export is the parity target; do not imply flat-video export already contains interactive components.

Judge the result by whether someone can create two visibly different designs, keep their content intact, and understand what each interaction does without reading code or a tutorial.
