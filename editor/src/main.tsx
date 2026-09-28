import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { startProjectAutosave } from "./app/projectAutosave";
import { registerEditorServiceWorker } from "./infrastructure/pwa/registerServiceWorker";
import { navigateProject } from "./app/navigation";
import { enterCameraHome } from "./app/homeEntry";
import { isWideLayout } from "./infrastructure/viewport";
import { useCapture } from "./state/captureStore";
import "./theme.css";

registerEditorServiceWorker();
const renderApp = () => {
  const entry = new URL(window.location.href);
  const state = useCapture.getState();
  const mobileHome = entry.searchParams.get("home") === "1" && !isWideLayout();
  enterCameraHome(mobileHome, !isWideLayout(), state);
  if (mobileHome) {
    entry.searchParams.delete("home");
    history.replaceState(history.state, "", entry);
  }
  // Preserve old installed-editor entry points when updating a saved editing session.
  if (!mobileHome && !entry.search && state.localId && state.screen === "editor") navigateProject(state.localId, true);
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
};
void startProjectAutosave().then(renderApp, error => {
  console.error("Restyle could not start browser autosave:", error);
  renderApp();
});
