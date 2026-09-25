import { useEffect } from "react";
import { Camera } from "./camera/Camera";
import { Editor } from "./editor/Editor";
import { Sheets } from "./sheets/Sheets";
import { locate, total } from "./lib/timeline";
import { uid, useCapture } from "./store";

export default function App() {
  const screen = useCapture(s => s.screen);
  const toast = useCapture(s => s.toast);
  const clips = useCapture(s => s.clips);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return;
      const s = useCapture.getState();
      if (event.key === "Escape") {
        if (s.sheet) s.patch({ sheet: null });
        else if (s.orb) s.patch({ orb: false });
        else if (s.sel >= 0) s.patch({ sel: -1 });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) s.redo(); else s.undo(); return; }
      if (s.sheet) return;
      if (s.screen !== "editor" || !s.clips.length) return;
      if (event.code === "Space") { event.preventDefault(); s.patch({ playing: !s.playing, t: s.t >= total(s.clips) ? 0 : s.t }); }
      if (event.key.toLowerCase() === "s") {
        const loc = locate(s.t, s.clips);
        if (!loc || loc.lt - loc.c.in < .15 * loc.c.speed || loc.c.out - loc.lt < .15 * loc.c.speed) { s.notify("Move the playhead inside a clip"); return; }
        const updated = [...s.clips];
        updated.splice(loc.i, 1, { ...loc.c, out: loc.lt }, { ...loc.c, id: uid(), in: loc.lt });
        s.edit({ clips: updated, sel: loc.i + 1, playing: false }); s.notify("Split");
      }
      if ((event.key === "Delete" || event.key === "Backspace") && s.sel >= 0) {
        const updated = s.clips.filter((_, index) => index !== s.sel);
        s.edit({ clips: updated, sel: -1, t: Math.min(s.t, total(updated)), playing: false, screen: updated.length ? "editor" : "camera" });
        s.notify("Clip deleted");
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  return <div className="app">{screen === "editor" && clips.length ? <Editor /> : <Camera />}<Sheets /><div className="toast" role="status" data-show={!!toast}>{toast}</div></div>;
}
