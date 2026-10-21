import { useEditorTransition } from "../ui/motion/EditorMotion";
import { ComponentPage } from "../features/component-page/ComponentPage";
import { OrbAssistant } from "../features/assistant/OrbAssistant";
import {
  assistantFocused,
  useAssistant,
} from "../state/assistant/assistantStore";
import {
  setAssistantThreadOpen,
  useAssistantThread,
} from "../state/assistant/threadStore";
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
import { useComponentAuthoring } from "../state/components/componentAuthoringStore";
import { useEditorPreferences } from "../state/preferences/editorPreferences";
import { DebugSheet } from "../features/try-debugger/DebugSheet";
import { setDebugOpen, useDebugUi } from "../features/try-debugger/uiStore";
import { editDebugComponent } from "../features/editor-layout/debugging/debugCommands";
import { locateDebugComponent } from "../features/editor-layout/debugging/debugLocate";
import { useDebugLifecycle } from "../features/editor-layout/debugging/useDebugLifecycle";

export function Editor() {
  useDebugLifecycle();
  const transition = useEditorTransition();
  const activeTool = useCapture((state) => state.sheet);
  const focusTool = [
    "componentOpacity",
    "componentTransform",
    "crop",
    "speed",
    "animation",
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
      !state.playheadPick,
  );
  const ratioOpen = useCapture((state) => state.sheet === "ratio");
  const voiceover = useCapture((state) => state.sheet === "voiceover");
  const textSheet = useCapture((state) => state.sheet === "text");
  const soundSheet = useCapture(
    (state) => state.sheet === "sound" || state.sheet === "soundEffects",
  );
  const animationSheet = useCapture((state) => state.sheet === "animation");
  const componentSheet = useCapture(
    (state) => state.sheet === "component" || state.sheet === "components",
  );
  const selectedComponent = useCapture((state) =>
    state.sheet === "component" ? state.selComp : null,
  );
  const pageComponent = useCapture((state) =>
    !state.playheadPick && state.sheet === "component"
      ? state.components.find((item) => item.id === state.selComp)
      : undefined,
  );
  const authoring = useComponentAuthoring();
  const advanced = useEditorPreferences(
    (state) => state.advancedEditingEnabled,
  );
  const codeEditingId =
    advanced &&
    authoring.tab === "advanced" &&
    authoring.componentId === selectedComponent
      ? (selectedComponent ?? undefined)
      : undefined;
  const trying = useCapture((state) => !!state.tryMode);
  const assistantActive = useAssistant(assistantFocused);
  const thread = useAssistantThread();
  if (!scenes.length) return null;
  if (pageComponent && !wide)
    return <ComponentPage key={pageComponent.id} component={pageComponent} />;
  if (wide) return <DesktopEditor />;
  return (
    <>
      <EditorWorkspace
        open={sheetOpen}
        activeTool={activeTool}
        focusTool={focusTool}
        ratioOpen={ratioOpen}
        textSheet={textSheet}
        soundSheet={soundSheet}
        animationSheet={animationSheet}
        componentSheet={componentSheet}
        codeEditingId={codeEditingId}
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
        preview={<Preview threadOpen={thread.open && !codeEditingId} />}
        timeline={
          <>
            <SceneTimeline>
              <Timeline />
            </SceneTimeline>
            <ToolRow />
          </>
        }
        sheets={<Sheets />}
        threadOpen={thread.open && !codeEditingId}
        onCloseThread={() => setAssistantThreadOpen(false)}
        assistant={(expanded, target, keyboardOpen) =>
          !voiceover && (
            <OrbAssistant
              placement={expanded ? "floating" : "workspace"}
              portalTarget={target}
              threadKeyboardOpen={keyboardOpen}
            />
          )
        }
        assistantActive={assistantActive || thread.open}
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
