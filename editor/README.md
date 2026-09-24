# PVO Editor prototype

This folder is deliberately separate from the SDK package. It contains a small browser editor with two responsibilities for the first checkpoint:

- split one MP4 or MOV into named scene ranges;
- add tooltip, card, choice, and form components, then edit their HTML and CSS appearance;
- edit on a layered timeline with one video track and a separate draggable, resizable track for every UI component.
- configure components in a modal dialog; choices and forms can pause playback and map conditions or results to destination scenes.
- switch between Media and Components tabs, choose a canvas ratio, and export the edited project as a `.pvo.mp4` or `.pvo.mov` file.

Each component has an absolute start and end time constrained to its scene. Full animation keyframes and easing are intentionally deferred.

Run the repository server and open `http://127.0.0.1:4173/editor/`.
