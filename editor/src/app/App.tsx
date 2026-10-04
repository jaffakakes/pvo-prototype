import { useEffect } from "react";
import { Camera } from "../features/capture/Camera";
import { UpdatePrompt } from "../features/update/UpdatePrompt";
import { NotificationHost } from "../features/notifications/NotificationHost";
import { useCapture } from "../state/captureStore";
import { useEditorPreferences } from "../state/preferences/editorPreferences";
import { useThemePreferences } from "../state/preferences/themePreferences";
import { Editor } from "./Editor";
import { Sheets } from "./Sheets";
import { useAppTouchGestures } from "./useAppTouchGestures";
import { useEditorKeyboard } from "./useEditorKeyboard";
import { useAppLocation } from "./navigation";
import { CreateEntry } from "../features/create-project/CreateEntry";
import { AuthDialog } from "../features/auth/AuthDialog";
import { openSignIn } from "../state/auth/authGateStore";
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
  const themeMode = useThemePreferences(state => state.mode);
  const themeAccent = useThemePreferences(state => state.accent);
  const picking = useCapture(s => !!s.playheadPick);
  useEditorKeyboard(!showLanding);
  useEffect(() => { useCapture.getState().patch({ ratioMenu: false }); }, [screen]);
  useEffect(() => {
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = themeMode === "system" ? (systemDark.matches ? "dark" : "light") : themeMode;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.accent = themeAccent;
      document.documentElement.style.colorScheme = resolved;
      const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (themeColor) themeColor.content = resolved === "light" ? "#F5F1EB" : "#0B0B0F";
    };
    applyTheme();
    systemDark.addEventListener("change", applyTheme);
    return () => systemDark.removeEventListener("change", applyTheme);
  }, [themeMode, themeAccent]);
  return (
    <div ref={appRef} className="app" data-screen={showLanding ? "create" : screen} data-playhead-pick={picking} data-reduce-motion={reduceMotion}>
      {navigation.switching ? <div className="projectTransition" role="status"><p>{navigation.error ?? "Opening your saved edit…"}</p>{navigation.error && <button onClick={() => history.back()}>Back to your edit</button>}</div>
        : createRoute ? <CreateEntry key={route.searchParams.get("template")} wide={wide} mobileView={screen === "editor" ? <Editor /> : <Camera />}
          hero={route.searchParams.has("drop") ? "drop" : "studio"} templateId={route.searchParams.get("template")} onSignIn={openSignIn} />
          : screen === "editor" ? <Editor /> : <Camera />}
      {!showLanding && screen !== "editor" && <Sheets />}
      <AuthDialog />
      <UpdatePrompt />
      <NotificationHost inlineRestore={showLanding} />
    </div>
  );
}
