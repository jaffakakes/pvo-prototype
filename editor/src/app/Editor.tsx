import { useEditorTransition } from "../ui/motion/EditorMotion";
import { ComponentPage } from "../features/component-page/ComponentPage";
import { useAssistantThread } from "../state/assistant/threadStore";
import { EditorWorkspace } from "../features/editor-layout/EditorWorkspace";
import { EditorHeader } from "../features/editor-layout/EditorHeader";
import { Preview } from "../features/preview/Preview";
import { SceneTimeline } from "../features/scenes/SceneTimeline";
import { Timeline } from "../features/timeline/Timeline";
import { ToolRow } from "../features/timeline/ToolRow";
import { useCapture } from "../state/captureStore";
import { Sheets } from "./Sheets";
import { DesktopEditor } from "../features/desktop-editor/DesktopEditor";
import { useWideLayout } from "../infrastructure/viewport";
import { DebugSheet } from "../features/try-debugger/DebugSheet";
import { setDebugOpen, useDebugUi } from "../features/try-debugger/uiStore";
import { editDebugComponent } from "../features/editor-layout/debugging/debugCommands";
import { locateDebugComponent } from "../features/editor-layout/debugging/debugLocate";
import { useDebugLifecycle } from "../features/editor-layout/debugging/useDebugLifecycle";
import {
  EditorToolDock,
  isEditorToolTray,
} from "../features/tool-trays/EditorToolDock";

export function Editor() {
  useDebugLifecycle();
  const transition = useEditorTransition();
  const activeTool = useCapture((state) => state.sheet);
  const focusTool = [
    "componentOpacity",
    "keyframes",
    "volumeKeyframes",
  ].includes(activeTool ?? "");
  const debugOpen = useDebugUi((state) => state.open);
  const wide = useWideLayout();
  const scenes = useCapture((state) => state.scenes);
  const sheetOpen = useCapture(
    (state) =>
      state.sheet !== null &&
      state.sheet !== "export" &&
      state.sheet !== "voiceover" &&
      state.sheet !== "ratio" &&
      !isEditorToolTray(state.sheet) &&
      !state.playheadPick,
  );
  const ratioOpen = useCapture((state) => state.sheet === "ratio");
  const voiceover = useCapture((state) => state.sheet === "voiceover");
  const textSheet = useCapture((state) => state.sheet === "text");
  const soundSheet = useCapture(
    (state) => state.sheet === "sound" || state.sheet === "soundEffects",
  );
  const trayOpen = isEditorToolTray(activeTool);
  const componentSheet = useCapture(
    (state) => state.sheet === "component" || state.sheet === "components",
  );
  const pageComponent = useCapture((state) =>
    !state.playheadPick && state.sheet === "component"
      ? state.components.find((item) => item.id === state.selComp)
      : undefined,
  );
  const trying = useCapture((state) => !!state.tryMode);
  const thread = useAssistantThread();
  if (!scenes.length) return null;
  if (pageComponent && !wide)
    return <ComponentPage key={pageComponent.id} component={pageComponent} />;
  if (wide) return <DesktopEditor />;
  return (
    <>
      <EditorWorkspace
        mode="timeline"
        open={sheetOpen}
        activeTool={activeTool}
        focusTool={focusTool}
        ratioOpen={ratioOpen}
        trayOpen={trayOpen}
        textSheet={textSheet}
        soundSheet={soundSheet}
        componentSheet={componentSheet}
        trying={trying}
        debugOpen={debugOpen}
        onCloseDebug={() => setDebugOpen(false)}
        debugPanel={
          <DebugSheet
            onClose={() => setDebugOpen(false)}
            onEditComponent={editDebugComponent}
            onLocate={locateDebugComponent}
          />
        }
        header={<EditorHeader />}
        preview={<Preview threadOpen={thread.open} />}
        timeline={
          <>
            <SceneTimeline>
              <Timeline />
            </SceneTimeline>
          </>
        }
        controls={
          <>
            <EditorToolDock />
            <ToolRow />
          </>
        }
        sheets={<Sheets trays />}
        assistantEnabled={!voiceover}
        onDismiss={() =>
          transition(
            "tool",
            () => useCapture.getState().patch({ sheet: null }),
            "close",
          )
        }
      />
    </>
  );
}
