# Scenes panel

The phone scene-tree button opens a panel over the timeline lanes. The player, its overlaid controls, scene row and toolbar retain their positions. This is a timeline view, separate from editing sheets and their shared player-corner close control.

Tree is the initial view. Tree/Map selection is a device preference stored as `restyle.scenes.view`, outside project history. Close, Escape or opening a Tree row restores the timeline and returns focus to the scene-tree button. Map scene taps navigate with the existing scene command while keeping the panel open. Opening an editing sheet or Try dismisses the panel.

`domain/scenes/graph.ts` derives depth-first nodes and exact choice labels from the current component fields, including compiled code-owned choices. Ancestry alone does not imply a viewer route, so an unconnected scene has no invented choice label. Rows show first-frame media, an empty dashed poster when there are no clips, and one status: currently editing, no content yet, or a child count. Multiple incoming options show the first label and a count. Arrow keys move between rows; Enter opens the focused scene. Right-click or hold a non-main row opens its existing scene-management controls.

The scene row's **+ Scene** and the Tree's **Add a branch** use `createSceneBranch`. It adds an empty child and a new two-option Choice in the source scene: the first option opens the child and the second continues. Existing authored components and outcomes are preserved. The scene and new Choice share one Undo step. Outcome-specific creation still uses `createRoutedScene` to connect the selected existing control.

Map shows the parent, current scene, its Choice nodes and immediate destinations. A child’s further branches are counted rather than expanded. Nodes recenter the map; choice nodes open the corresponding editor. Drag and pinch navigate the canvas; zoom controls and Fit expose the full ancestry tree. Fit outlines the current hop. The diagram scales to the available lane height; short screens allow internal scrolling. Below 500px tall, the workspace reserves a minimum timeline area before the panel opens, while keeping at least 40px of preview; opening Scenes still leaves the surrounding geometry unchanged. OS reduced motion disables map transitions.

Presentation stays in `features/scenes/`: panel navigation, Tree rows, Map rendering, pure pixel layout, pointer/resize handling and media posters each have their own owner. The project schema is unchanged.

Checks: `node --test tests/editor-scenes-panel.test.mjs tests/editor-scene-tree.test.mjs`; `npm run check:browser -- editor scenes-design scene-tree` against a source Vite server. The design check uses real imported media plus a local authored-scene fixture, and exercises phone, narrow, landscape and dark layouts. Physical-device pinch/keyboard behaviour still needs device verification.
