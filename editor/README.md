# PVO Editor prototype

This folder is deliberately separate from the SDK package. It contains a small browser editor with two responsibilities for the first checkpoint:

- import multiple MP4 or MOV files and append each one after the last clip on one shared timeline;
- split timeline clips for normal editing without creating a new scene, and rename scenes separately;
- delete a selected timeline clip with the toolbar or keyboard while keeping its source in Media so it can be added back;
- add tooltip, card, choice, and form components, then edit their HTML and CSS appearance;
- edit on a layered timeline with one video track and a separate draggable, resizable track for every UI component.
- configure components in a modal dialog; choices and forms can map Yes and No to any imported media, including media outside the main timeline or the same destination, and branch when their layer ends;
- keep the main timeline clear by opening branch views from a dropdown and returning with the Main timeline button;
- save imported media and project edits in browser storage, then restore the active project automatically after a refresh;
- switch between Media and Components tabs, choose a canvas ratio, and export a single-source timeline as a `.pvo.mp4` or `.pvo.mov` file.

Each component has a local start and end time constrained to its media clip. Full animation keyframes and easing are intentionally deferred.

The editor previews a multi-media timeline by switching sources at clip boundaries. Rendering several source files into one encoded MP4 or MOV is the next export step; the current packer still exports single-source timelines without transcoding.

Run the repository server and open `http://127.0.0.1:4173/editor/`.
