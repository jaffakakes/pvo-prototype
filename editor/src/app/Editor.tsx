import { OrbAssistant } from "../features/assistant/OrbAssistant";
import { useAssistant } from "../state/assistant/assistantStore";
import { setAssistantThreadOpen, useAssistantThread } from "../state/assistant/threadStore";
import { EditorWorkspace } from "../features/editor-layout/EditorWorkspace";
import { EditorHeader } from "../features/editor-layout/EditorHeader";
import { Preview } from "../features/preview/Preview";
import { Transport } from "../features/preview/Transport";
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
  const debugOpen = useDebugUi(state => state.open);
  const wide = useWideLayout();
  const scenes = useCapture(state => state.scenes);
  const sheetOpen = useCapture(state => state.sheet !== null && state.sheet !== "export" && !state.playheadPick);
  const animationSheet = useCapture(state => state.sheet === "animation");
  const componentSheet = useCapture(state => state.sheet === "component" || state.sheet === "components");
  const selectedComponent = useCapture(state => state.sheet === "component" ? state.selComp : null);
  const authoring = useComponentAuthoring();
  const advanced = useEditorPreferences(state => state.advancedEditingEnabled);
  const codeEditingId = advanced && authoring.tab === "advanced" && authoring.componentId === selectedComponent
    ? selectedComponent ?? undefined : undefined;
  const trying = useCapture(state => !!state.tryMode);
  const assistantActive = useAssistant(state => state.phase !== "idle");
  const thread = useAssistantThread();
  if (!scenes.length) return null;
  if (wide) return <DesktopEditor />;
  return <>
    <EditorWorkspace open={sheetOpen} animationSheet={animationSheet} componentSheet={componentSheet} codeEditingId={codeEditingId} trying={trying}
      debugOpen={debugOpen} onCloseDebug={() => setDebugOpen(false)}
      debugPanel={<DebugSheet onClose={() => setDebugOpen(false)} onEditComponent={editDebugComponent} onLocate={locateDebugComponent} />}
      header={<EditorHeader />} preview={<Preview />} playback={<Transport threadOpen={thread.open && !codeEditingId} />}
      timeline={<><SceneTimeline><Timeline /></SceneTimeline><ToolRow /></>} sheets={<Sheets />}
      threadOpen={thread.open && !codeEditingId} threadCollapsed={thread.collapsed}
      onCloseThread={() => setAssistantThreadOpen(false)}
      assistant={(expanded, target, keyboardOpen) => <OrbAssistant placement={expanded ? "floating" : "workspace"}
        portalTarget={target} threadKeyboardOpen={keyboardOpen} />}
      assistantActive={assistantActive || thread.open}
      onDismiss={() => useCapture.getState().patch({ sheet: null })} />
  </>;
}
