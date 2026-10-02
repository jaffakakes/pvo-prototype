import { extractSelectedAudio } from "../../../state/editing/audioCommands";
import { dur } from "../../../domain/clips/timing";
import type { Clip } from "../../../domain/project/model";
import { useCapture } from "../../../state/captureStore";
import { adjustSelectedClip, setSelectedClipSpeed } from "../../../state/editing/clipAdjustmentCommands";
import { InspectorSections, type InspectorSection } from "./InspectorControls";

export function ClipInspector({ clip, tab, onOpenLibrary }: { clip: Clip; tab: string; onOpenLibrary: (tab: string) => void }) {
  const muted = useCapture(state => state.muted);
  let sections: InspectorSection[];
  switch (tab) {
    case "Audio":
      sections = [{ title: "Original sound", controls: [
        ...(clip.audioDetached ? [{ kind: "note" as const, text: "Audio extracted to a separate layer." }]
          : clip.url ? [{ kind: "link" as const, label: "Extract audio", onClick: extractSelectedAudio }] : []),
        { kind: "toggle", label: "Mute original sound", on: muted, onToggle: () => useCapture.getState().edit({ muted: !muted }) },
        { kind: "note", text: "Applies to all clips in this scene." },
        { kind: "link", label: "＋ Browse music", onClick: () => onOpenLibrary("audio") },
      ] }];
      break;
    case "Speed":
      sections = [{ title: "Speed", controls: [
        { kind: "chips", options: ["0.5×", "1×", "2×", "4×"], value: `${clip.speed}×`, onPick: value => setSelectedClipSpeed(Number.parseFloat(value)) },
        { kind: "slider", label: "Speed", value: clip.speed, min: .25, max: 4, step: .05, unit: "×", digits: 2,
          onChange: setSelectedClipSpeed },
        { kind: "list", rows: [{ label: "Length", value: `${(clip.out - clip.in).toFixed(1)}s → ${dur(clip).toFixed(1)}s` }] },
      ], onReset: () => setSelectedClipSpeed(1) }];
      break;
    case "Mask":
      // TODO(design): mask controls need matching preview, export and player support.
      sections = [{ title: "Mask", controls: [{ kind: "note", text: "Masks aren’t available in this beta yet." }] }];
      break;
    default:
      sections = [{ title: "Video fit", controls: [
        { kind: "toggle", label: "Mirror", on: clip.mirror, onToggle: () => { adjustSelectedClip({ mirror: !clip.mirror }); } },
        { kind: "chips", label: "Fit", options: ["Fill", "Fit"], value: clip.fit === "contain" ? "Fit" : "Fill",
          onPick: value => { adjustSelectedClip({ fit: value === "Fit" ? "contain" : "cover" }); } },
      ], onReset: () => { adjustSelectedClip({ zoom: 1, mirror: false, fit: "cover" }); } },
      { title: "Effects on this clip", controls: [
        { kind: "link", label: "＋ Browse effects", onClick: () => onOpenLibrary("effects") },
        { kind: "note", text: "Effects aren’t available in this beta yet." },
      ] }];
  }
  return <InspectorSections sections={sections} />;
}
