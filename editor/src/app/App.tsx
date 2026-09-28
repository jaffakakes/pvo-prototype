import { useEffect } from "react";
import { Camera } from "../features/capture/Camera";
import { UpdatePrompt } from "../features/update/UpdatePrompt";
import { NotificationHost } from "../features/notifications/NotificationHost";
import { useCapture } from "../state/captureStore";
import { useEditorPreferences } from "../state/preferences/editorPreferences";
import { Editor } from "./Editor";
import { Sheets } from "./Sheets";
import { useAppTouchGestures } from "./useAppTouchGestures";
import { useEditorKeyboard } from "./useEditorKeyboard";
import { useAppLocation } from "./navigation";
import { CreateEntry } from "../features/create-project/CreateEntry";
import { AuthDialog } from "../features/auth/AuthDialog";
import { closeAuthGate, openSignIn } from "../state/auth/authGateStore";
import { useProjectNavigation } from "./useProjectNavigation";
import { useWideLayout } from "../infrastructure/viewport";

export default function App() {
  const appRef = useAppTouchGestures();
  const screen = useCapture(s => s.screen);
  const wide = useWideLayout();
  const route = useAppLocation();
  const projectId = route.searchParams.get("project");
  const localId = useCapture(s => s.localId);
  const createRoute = (!projectId || projectId !== localId) && (screen !== "editor"
    || route.searchParams.get("home") === "1" || route.searchParams.has("template") || route.searchParams.has("drop"));
  const showLanding = wide && createRoute;
  const navigation = useProjectNavigation(projectId);
  const reduceMotion = useEditorPreferences(s => s.reduceMotion);
  const picking = useCapture(s => !!s.playheadPick);
  useEditorKeyboard(!showLanding);
  useEffect(() => { useCapture.getState().patch({ ratioMenu: false }); }, [screen]);
  useEffect(() => { if (!wide) closeAuthGate(); }, [wide]);
  return (
    <div ref={appRef} className="app" data-screen={showLanding ? "create" : screen} data-playhead-pick={picking} data-reduce-motion={reduceMotion}>
      {navigation.switching ? <div className="projectTransition" role="status"><p>{navigation.error ?? "Opening your saved edit…"}</p>{navigation.error && <button onClick={() => history.back()}>Back to your edit</button>}</div>
        : createRoute ? <CreateEntry key={route.searchParams.get("template")} wide={wide} mobileView={screen === "editor" ? <Editor /> : <Camera />}
          hero={route.searchParams.has("drop") ? "drop" : "studio"} templateId={route.searchParams.get("template")} onSignIn={openSignIn} />
          : screen === "editor" ? <Editor /> : <Camera />}
      {!showLanding && screen !== "editor" && <Sheets />}
      <AuthDialog />
      <UpdatePrompt />
      <NotificationHost />
    </div>
  );
}
