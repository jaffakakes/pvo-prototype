import { useRef, useState, type ComponentProps, type ComponentType } from "react";
import { useWideLayout } from "../../../infrastructure/viewport";
import { beginPvoEdit, isVisualEditingBlocked, restoreLastValidPvo, returnToVisualEditing } from "../../../domain/components/codeOwnership";
import { componentLanguageSource } from "../../../domain/components/languageCompilation";
import type { PvoLanguageSource } from "../../../domain/components/languageSource";
import { componentLook, lookPresetName } from "../../../domain/components/look";
import { useCapture } from "../../../state/captureStore";
import { selectComponentSourcePart, setCodePreviewFocus, setComponentAuthoringTab, useComponentAuthoring, type ComponentAuthoringTab } from "../../../state/components/componentAuthoringStore";
import { setAdvancedEditingEnabled, useEditorPreferences } from "../../../state/preferences/editorPreferences";
import { fmt } from "../../../ui/formatTime";
import { useSheetDock } from "../../../ui/sheets/SheetDockContext";
import { LayerPositionControls } from "../../overlay-position/LayerPositionControls";
import { KeyframeEditor } from "../../animation/KeyframeEditor";
import positionStyles from "../../overlay-position/LayerPositionControls.module.css";
import { nameOf } from "../catalog";
import { PvoLanguageRoute } from "../language/PvoLanguageRoute";
import { usePvoCompilation } from "../language/usePvoCompilation";
import { usePvoFormatting } from "../language/usePvoFormatting";
import { LookTab } from "../look/LookTab";
import { ComponentSizeControls } from "../size/ComponentSizeControls";
import { ActionTab } from "../outcomes/ActionTab";
import { Picker } from "../Picker";
import { SheetFrame } from "../SheetFrame";
import { ContentTab } from "./ContentTab";
import { TimingControls } from "./TimingControls";
import styles from "../NoCodeEditor.module.css";

const TABS: { id: ComponentAuthoringTab; label: string }[] = [
  { id: "content", label: "Content" }, { id: "look", label: "Look" },
  { id: "action", label: "Action" }, { id: "advanced", label: "Advanced" },
];

export type ComponentEditorFrameProps = ComponentProps<typeof SheetFrame>;

export function EditorSheet({ Frame = SheetFrame, lookPreviewScale }: {
  Frame?: ComponentType<ComponentEditorFrameProps>; lookPreviewScale?: number;
} = {}) {
  const wide = useWideLayout();
  const component = useCapture(state => state.components.find(item => item.id === state.selComp));
  const update = useCapture(state => state.updateComponent);
  const advanced = useEditorPreferences(state => state.advancedEditingEnabled);
  const session = useComponentAuthoring();
  const dock = useSheetDock();
  const feedback = usePvoCompilation(component);
  const formatting = usePvoFormatting(component,
    advanced && session.componentId === component?.id && session.tab === "advanced",
    feedback.state === "valid" && !dock?.assistantActive);
  const [resetId, setResetId] = useState<string | null>(null);
  const editedCode = useRef(false);
  if (!component) return <Picker />;
  const blocked = isVisualEditingBlocked(component);
  const legacy = !!component.code && !component.code.pvo;
  const selectedTab = session.componentId === component.id ? session.tab : "content";
  const tab = selectedTab === "advanced" && !advanced ? "content" : selectedTab;
  const codeExpanded = tab === "advanced" && !!dock?.expanded;
  const assistantActive = !!dock?.assistantActive;
  const close = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    useCapture.getState().patch({ sheet: null });
  };
  const selectTab = (next: ComponentAuthoringTab) => {
    editedCode.current = false;
    setComponentAuthoringTab(component.id, next);
  };
  const editPvo = (part: keyof PvoLanguageSource, value: string) => {
    formatting.onEdit();
    const current = useCapture.getState().components.find(item => item.id === component.id);
    if (!current || legacy) return;
    update(component.id, beginPvoEdit(current, part, value), !editedCode.current);
    editedCode.current = true;
  };
  const source = componentLanguageSource(component);
  const restore = () => {
    const current = useCapture.getState().components.find(item => item.id === component.id);
    const changes = current && restoreLastValidPvo(current);
    if (changes) update(component.id, changes);
  };
  const canRestore = !!restoreLastValidPvo(component);
  const openAdvanced = (part: keyof PvoLanguageSource = "structure") => {
    if (!advanced) setAdvancedEditingEnabled(true);
    editedCode.current = false;
    selectComponentSourcePart(component.id, part);
  };
  const resetConfirm = resetId === component.id;
  return <Frame title={nameOf(component.type)}
    sub={`Appears at ${fmt(component.at)} · ${lookPresetName(componentLook(component).preset)} look`}
    onBack={close} onClose={close} doneLabel="Done" fillBody={tab === "advanced"} disabled={assistantActive} navigation={!codeExpanded &&
    <div className={styles.tabs} role="tablist" aria-label="Component tools" data-component-tabs {...(assistantActive ? { inert: "" } : {})}>
      {TABS.filter(item => item.id !== "advanced" || advanced).map(item => <button key={item.id}
        type="button" role="tab" aria-selected={tab === item.id}
        onClick={() => selectTab(item.id)}>{item.label}</button>)}
    </div>}>
    {resetConfirm ? <div className={styles.banner} role="alertdialog" aria-label="Recover this component?">
      <strong>Recover this component?</strong>
      <p>Rebuild it from its saved wording and actions with the Bold look. The older source stays archived.</p>
      <button className={styles.primary} type="button" onClick={() => {
        update(component.id, returnToVisualEditing(component)); setResetId(null); selectTab("content");
      }}>Recover component</button>
      <button className={styles.secondary} type="button" onClick={() => setResetId(null)}>Cancel</button>
    </div> : <>
      {legacy && <div className={styles.banner}>
        <strong>This component uses an older format.</strong>
        <p>Recover it to edit its wording and appearance. Your original source will be kept.</p>
        <button type="button" onClick={() => setResetId(component.id)}>Recover component…</button>
      </div>}
      {blocked && !legacy && tab !== "advanced" && <div className={styles.banner}
        role={feedback.state === "invalid" ? "alert" : "status"} data-component-draft-status={feedback.state}>
        <strong>{feedback.state === "invalid" ? "Your Advanced edit needs attention." : "Checking your changes…"}</strong>
        {feedback.state === "invalid" && <>
          <p>{feedback.message}</p>
          <div className={styles.inlineActions}>
            <button type="button" onClick={() => openAdvanced(feedback.part ?? "structure")}>Open Advanced</button>
            {canRestore && <button type="button" onClick={restore}>Restore previous version</button>}
          </div>
        </>}
      </div>}
      {tab === "content" && <>
        <ContentTab key={component.id} component={component} disabled={blocked} />
        <TimingControls component={component} />
      </>}
      {tab === "look" && <>
        {!wide && <section className={positionStyles.section}>
          <LayerPositionControls key={component.id} target={{ kind: "component", id: component.id }}
            x={component.x} y={component.y} />
        </section>}
        {wide && <ComponentSizeControls key={component.id} component={component} />}
        <LookTab component={component} disabled={blocked} previewScale={lookPreviewScale} />
        {wide ? <KeyframeEditor key={`component:${component.id}`} target={{ kind: "component", id: component.id }} />
          : <button type="button" className={styles.inlineActions} onClick={() => useCapture.getState().patch({ sheet: "animation", playing: false })}>◆ Animate</button>}
      </>}
      {tab === "action" && <ActionTab key={component.id} component={component} onOpenAdvanced={() => openAdvanced("logic")} />}
      {tab === "advanced" && !legacy && <>
        <div className={styles.languageEditor} data-expanded={codeExpanded} onFocusCapture={() => {
          editedCode.current = false;
          setCodePreviewFocus(true);
        }}>
          <PvoLanguageRoute key={component.id} component={component} source={source} tab={session.sourcePart}
            onSelectTab={part => selectComponentSourcePart(component.id, part)}
            onEdit={editPvo} feedback={feedback} onRestore={canRestore ? restore : undefined}
            assistantActive={assistantActive} registerAssistantTarget={dock?.registerAssistantTarget}
            onSourceBlur={formatting.onBlur}
            expanded={dock?.expanded ?? false} onExpand={() => dock?.setExpanded(!dock.expanded)} />
        </div>
      </>}
    </>}
  </Frame>;
}
