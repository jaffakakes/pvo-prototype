# PVO Editor prototype

This folder is deliberately separate from the SDK package. It contains a small browser editor with two responsibilities for the first checkpoint:

- import multiple MP4 or MOV files, switch between them, and keep each file's edit state;
- split the selected file into named scene ranges;
- add tooltip, card, choice, and form components, then edit their HTML and CSS appearance;
- edit on a layered timeline with one video track and a separate draggable, resizable track for every UI component.
- configure components in a modal dialog; choices and forms can pause playback and map conditions or results to destination scenes.
- switch between Media and Components tabs, choose a canvas ratio, and export the selected item as a `.pvo.mp4` or `.pvo.mov` file.

Each component has an absolute start and end time constrained to its scene. Full animation keyframes and easing are intentionally deferred.

The media library keeps separate scenes, components, canvas ratio, and playhead position for every imported file. Export applies to the currently selected media item; combining several source files into one encoded video is outside this basic editor.

Run the repository server and open `http://127.0.0.1:4173/editor/`.
