import { useCallback, useEffect, useState } from "react";
import { useCapture } from "../../state/captureStore";
import { useAssistant } from "../../state/assistant/assistantStore";
import { OrbAssistant } from "../assistant/OrbAssistant";
import { DesktopHeader } from "./DesktopHeader";
import { DesktopDialogs } from "./DesktopDialogs";
import { DesktopLibrary } from "./library/DesktopLibrary";
import { DesktopInspector } from "./inspector/DesktopInspector";
import { DesktopPlayer } from "./player/DesktopPlayer";
import { DesktopTimeline } from "./timeline/DesktopTimeline";
import styles from "./DesktopEditor.module.css";

/** Desktop presentation shares the mobile editor's project, history and commands. */
export function DesktopEditor() {
  const [library, setLibrary] = useState("media");
  const [safeZone, setSafeZone] = useState(true);
  const [snap, setSnap] = useState(true);
  const [assistantTarget, setAssistantTarget] = useState<HTMLElement | null>(null);
  const sheet = useCapture(state => state.sheet);
  const selText = useCapture(state => state.selText);
  const assistantActive = useAssistant(state => state.phase !== "idle");
  const trying = useCapture(state => !!state.tryMode);
  const picking = useCapture(state => !!state.playheadPick);
  const openLibrary = useCallback((tab: string) => setLibrary(tab.toLowerCase()), []);
  const openProject = () => useCapture.getState().patch({
    sel: -1, selComp: null, selText: null, sheet: null, ratioMenu: false,
  });

  useEffect(() => {
    if (sheet === "components" || (sheet === "text" && selText == null)) {
      openLibrary(sheet === "components" ? "components" : "text");
      useCapture.getState().patch({ sheet: null });
    }
  }, [sheet, selText, openLibrary]);

  return <div className={styles.editor} data-desktop-editor>
    <div {...(assistantActive || picking ? { inert: "" } : {})}>
      <DesktopHeader onOpenProject={openProject} />
    </div>
    <main className={styles.body} aria-label="Video editor">
      <div className={styles.region} {...(assistantActive || trying || picking ? { inert: "" } : {})}>
        <DesktopLibrary tab={library} onTabChange={openLibrary} />
      </div>
      <div className={styles.region} {...(assistantActive || picking ? { inert: "" } : {})}>
        <DesktopPlayer safeZone={safeZone} onSafeZoneChange={setSafeZone}
          onOpenProject={openProject} onOpenLibrary={openLibrary} />
      </div>
      <div className={styles.region} {...((assistantActive && !assistantTarget) || trying || picking ? { inert: "" } : {})}>
        <DesktopInspector safeZone={safeZone} onSafeZoneChange={setSafeZone}
          snap={snap} onSnapChange={setSnap} onOpenLibrary={openLibrary}
          onAssistantTargetChange={setAssistantTarget} />
      </div>
      <div className={styles.timeline}>
        <DesktopTimeline snap={snap} onSnapChange={setSnap}
          onOpenLibrary={openLibrary} assistant={<OrbAssistant
            placement={assistantTarget ? "floating" : "toolbar"} portalTarget={assistantTarget} />} />
      </div>
    </main>
    <DesktopDialogs />
  </div>;
}
