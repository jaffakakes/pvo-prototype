# PVO Editor prototype

This folder is deliberately separate from the SDK package. It contains a small browser editor with two responsibilities for the first checkpoint:

- split one MP4 into named scene ranges;
- add tooltip, card, choice, and form components, then edit their HTML and CSS appearance;
- time each component with a draggable, resizable bar beneath the scene clips.

Each component has an absolute start and end time constrained to its scene. Full animation keyframes and easing are intentionally deferred.

Run the repository server and open `http://127.0.0.1:4173/editor/`.
