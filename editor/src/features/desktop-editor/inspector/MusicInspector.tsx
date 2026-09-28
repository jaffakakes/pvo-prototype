import { useCapture } from "../../../state/captureStore";
import { SOUNDS } from "../../sound/catalog";
import { InspectorSections } from "./InspectorControls";

export function MusicInspector({ onOpenLibrary }: { onOpenLibrary: (tab: string) => void }) {
  const sound = useCapture(state => state.sound);
  const muted = useCapture(state => state.muted);
  return <InspectorSections sections={[{ title: "Music", controls: [
    { kind: "list", rows: [{ label: "Track", value: SOUNDS[sound]?.name ?? "Original sound" }] },
    { kind: "toggle", label: "Mute original sound", on: muted, onToggle: () => useCapture.getState().edit({ muted: !muted }) },
    { kind: "link", label: "↻ Swap track", onClick: () => onOpenLibrary("audio") },
    ...(sound > 0 ? [{ kind: "link" as const, label: "Remove music", onClick: () => useCapture.getState().edit({ sound: 0 }) }] : []),
  ] }]} />;
}
