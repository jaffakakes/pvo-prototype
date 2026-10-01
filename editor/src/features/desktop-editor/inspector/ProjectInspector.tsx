import { sceneDuration } from "../../../domain/scenes/duration";
import type { Ratio } from "../../../domain/project/model";
import { useCapture } from "../../../state/captureStore";
import { fmt } from "../../../ui/formatTime";
import { InspectorSections, type InspectorSection } from "./InspectorControls";
import styles from "./Inspector.module.css";

const RATIOS: { value: Ratio; width: number; height: number; hint: string }[] = [
  { value: "9:16", width: 14, height: 24, hint: "TikTok · Reels · Shorts" },
  { value: "1:1", width: 20, height: 20, hint: "Square feed post" },
  { value: "4:5", width: 18, height: 23, hint: "Instagram feed" },
  { value: "16:9", width: 24, height: 14, hint: "YouTube · landscape" },
];

export function ProjectInspector({ safeZone, onSafeZoneChange, snap, onSnapChange }: {
  safeZone?: boolean; onSafeZoneChange?: (enabled: boolean) => void;
  snap?: boolean; onSnapChange?: (enabled: boolean) => void;
}) {
  const state = useCapture();
  const scene = state.scenes.find(item => item.id === state.currentSceneId);
  const sections: InspectorSection[] = [{ title: "Project", controls: [
    { kind: "field", label: "Name", value: state.projectName, max: 40, placeholder: "Untitled edit",
      onChange: value => state.patch({ projectName: value }) },
    { kind: "tiles", label: "Aspect ratio", columns: 4, items: RATIOS.map(ratio => ({
      label: ratio.value, selected: state.ratio === ratio.value,
      glyph: <i className={styles.ratioGlyph} style={{ width: ratio.width, height: ratio.height }} />,
      onPick: () => { if (state.ratio !== ratio.value) state.edit({ ratio: ratio.value }); },
    })) },
    { kind: "note", text: RATIOS.find(ratio => ratio.value === state.ratio)?.hint ?? "" },
  ] }];
  const guides: InspectorSection = { title: "Guides", controls: [] };
  if (onSafeZoneChange) guides.controls.push({ kind: "toggle", label: "Safe zone", on: !!safeZone, onToggle: () => onSafeZoneChange(!safeZone) });
  if (onSnapChange) guides.controls.push({ kind: "toggle", label: "Snap to edges", on: !!snap, onToggle: () => onSnapChange(!snap) });
  if (guides.controls.length) sections.push(guides);
  sections.push({ title: "This project", controls: [
    { kind: "list", rows: [
      { label: "Scenes", value: String(state.scenes.length) },
      { label: "Components", value: String(state.scenes.reduce((count, item) => count + item.components.length, 0)) },
      { label: `${scene?.name ?? "Scene"} length`, value: fmt(sceneDuration(state)) },
    ] },
    { kind: "note", text: "Saved in this browser. Your project stays here when you come back." },
    { kind: "link", label: "More settings", onClick: () => state.patch({ sheet: "more" }) },
  ] });
  return <InspectorSections sections={sections} />;
}
