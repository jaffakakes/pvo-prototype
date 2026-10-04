import { useAnimationSelection } from "../../../state/animation/selection";
import { AudioClipInspector } from "./AudioClipInspector";
import { useCallback, useEffect, useMemo, useState } from "react";
import { dur, total } from "../../../domain/clips/timing";
import { useCapture } from "../../../state/captureStore";
import { useAssistant } from "../../../state/assistant/assistantStore";
import { clearTimelineSelection } from "../../../state/editing/selectionCommands";
import { useComponentAuthoring } from "../../../state/components/componentAuthoringStore";
import { useEditorPreferences } from "../../../state/preferences/editorPreferences";
import { fmt } from "../../../ui/formatTime";
import { SheetDockContext } from "../../../ui/sheets/SheetDockContext";
import { EditorSheet } from "../../component-authoring/fields/EditorSheet";
import { KeyframeEditor } from "../../animation/KeyframeEditor";
import { SOUNDS } from "../../sound/catalog";
import { ClipInspector } from "./ClipInspector";
import { ComponentInspectorFrame } from "./ComponentInspectorFrame";
import { InspectorHeader, InspectorTabs } from "./InspectorChrome";
import { MusicInspector } from "./MusicInspector";
import { ProjectInspector } from "./ProjectInspector";
import { TextInspector } from "./TextInspector";
import { useInspectorExpansion } from "./useInspectorExpansion";
import styles from "./Inspector.module.css";

type Props = {
  onOpenLibrary: (tab: string) => void;
  snap?: boolean;
  onSnapChange?: (enabled: boolean) => void;
  onAssistantTargetChange?: (target: HTMLElement | null) => void;
};

export function DesktopInspector({ onOpenLibrary, snap, onSnapChange, onAssistantTargetChange }: Props) {
  const state = useCapture();
  const authoring = useComponentAuthoring();
  const advanced = useEditorPreferences(preferences => preferences.advancedEditingEnabled);
  const assistantActive = useAssistant(assistant => assistant.phase !== "idle");
  const expansion = useInspectorExpansion(state.selComp ?? undefined, advanced && authoring.tab === "advanced", assistantActive);
  const registerAssistantTarget = useCallback((target: HTMLDivElement | null) => {
    onAssistantTargetChange?.(target);
  }, [onAssistantTargetChange]);
  const dock = useMemo(() => ({ ...expansion.dock, assistantActive, registerAssistantTarget }),
    [expansion.dock, assistantActive, registerAssistantTarget]);
  const selectedKey = useAnimationSelection(value => value.selection);
  const [clipTab, setClipTab] = useState("Video");
  const [textTab, setTextTab] = useState("Text");
  useEffect(() => {
    if (!selectedKey || selectedKey.sceneId !== state.currentSceneId) return;
    if (selectedKey.target.kind === "text" && selectedKey.target.id === state.selText) setTextTab("Style");
    if (selectedKey.target.kind === "clip" && selectedKey.target.id === state.clips[state.sel]?.id)
      setClipTab(selectedKey.group === "volume" ? "Audio" : "Video");
  }, [selectedKey]);
  useEffect(() => {
    if (state.sheet === "speed") setClipTab("Speed");
    if (state.sheet === "crop") setClipTab("Video");
  }, [state.sheet]);
  const component = state.components.find(item => item.id === state.selComp);
  const text = state.texts.find(item => item.id === state.selText);
  const clip = state.clips[state.sel];
  const audio = state.audioClips.find(item => item.id === state.selAudio);
  const music = state.sheet === "sound" || (state.sheet === "animation" && state.sound > 0 && !component && !text && !clip && !audio);
  const deselect = clearTimelineSelection;
  let content;
  if (component) content = <EditorSheet key={component.id} Frame={ComponentInspectorFrame} lookPreviewScale={.5} />;
  else if (text) content = <>
    <InspectorHeader title={text.text || "Text"} subtitle={`Text · ${fmt(text.start)}–${fmt(text.end)}`}
      icon="text" kind="text" onDeselect={deselect} />
    <InspectorTabs tabs={["Text", "Style"]} selected={textTab} onSelect={setTextTab} />
    <div className={styles.body}>
      {textTab === "Style" && <KeyframeEditor key={`text:${text.id}`} target={{ kind: "text", id: text.id }} />}
      <TextInspector key={text.id} text={text} tab={textTab} />
    </div>
  </>;
  else if (audio) content = <>
    <InspectorHeader title={audio.name} subtitle="Extracted audio" icon="music" kind="music" onDeselect={deselect} />
    <div className={styles.body}>
      <AudioClipInspector clip={audio} />
      <KeyframeEditor key={`audio:${audio.id}`} target={{ kind: "audio", id: audio.id }} />
    </div>
  </>;
  else if (music) content = <>
    <InspectorHeader title={SOUNDS[state.sound]?.name ?? "Music"} subtitle="Music · this scene" icon="music" kind="music" onDeselect={deselect} />
    <InspectorTabs tabs={["Music"]} selected="Music" onSelect={() => {}} />
    <div className={styles.body}>
      <MusicInspector onOpenLibrary={onOpenLibrary} />
      {state.sound > 0 && <KeyframeEditor target={{ kind: "music" }} />}
    </div>
  </>;
  else if (clip) content = <>
    <InspectorHeader title={`Clip ${state.sel + 1}`} subtitle={`Clip · ${dur(clip).toFixed(1)}s · starts ${fmt(total(state.clips.slice(0, state.sel)))}`}
      icon="edit" kind="clip" onDeselect={deselect} />
    <InspectorTabs tabs={["Video", "Audio", "Speed", "Mask"]} selected={clipTab} onSelect={tab => {
      setClipTab(tab);
      if (state.sheet === "speed" || state.sheet === "crop") state.patch({ sheet: null });
    }} />
    <div className={styles.body}>
      {(clipTab === "Video" || clipTab === "Audio") && <KeyframeEditor key={`clip:${clip.id}:${clipTab}`} target={{ kind: "clip", id: clip.id }}
        groups={clipTab === "Audio" ? ["volume"] : ["position", "scale", "rotation", "opacity"]} />}
      <ClipInspector key={clip.id} clip={clip} tab={clipTab} onOpenLibrary={onOpenLibrary} />
    </div>
  </>;
  else content = <>
    <InspectorHeader title="Project" subtitle="Nothing selected · click the timeline to edit" icon="pvoExport" kind="project" />
    <InspectorTabs tabs={["Project"]} selected="Project" onSelect={() => {}} />
    <div className={styles.body}><ProjectInspector snap={snap} onSnapChange={onSnapChange} /></div>
  </>;
  return <>
    {expansion.expanded && <div className={styles.backdrop} aria-hidden="true" onClick={() => expansion.setExpanded(false)} />}
    <aside ref={expansion.panel} className={styles.panel} data-expanded={expansion.expanded}
      role={expansion.expanded ? "dialog" : "complementary"} aria-modal={expansion.expanded || undefined}
      aria-label={expansion.expanded ? "Component code editor" : "Inspector"} data-desktop-inspector>
      <div className={styles.content}>
        <SheetDockContext.Provider value={dock}>{content}</SheetDockContext.Provider>
      </div>
    </aside>
  </>;
}
