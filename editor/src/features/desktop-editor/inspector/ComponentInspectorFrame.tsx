import { useCapture } from "../../../state/captureStore";
import { clearTimelineSelection } from "../../../state/editing/selectionCommands";
import { useComponentAuthoring } from "../../../state/components/componentAuthoringStore";
import { useEditorPreferences } from "../../../state/preferences/editorPreferences";
import { componentLook, lookPresetName } from "../../../domain/components/look";
import { fmt } from "../../../ui/formatTime";
import { useSheetDock } from "../../../ui/sheets/SheetDockContext";
import { TYPES } from "../../component-authoring/catalog";
import { type ComponentEditorFrameProps } from "../../component-authoring/fields/EditorSheet";
import { InspectorHeader } from "./InspectorChrome";
import styles from "./Inspector.module.css";
import componentStyles from "./ComponentInspector.module.css";

/** Adapts the shared authoring workflow to the desktop panel without changing its commands. */
export function ComponentInspectorFrame({ title, sub, navigation, children, disabled = false }: ComponentEditorFrameProps) {
  const component = useCapture(state => state.components.find(item => item.id === state.selComp));
  const session = useComponentAuthoring();
  const advanced = useEditorPreferences(state => state.advancedEditingEnabled);
  const dock = useSheetDock();
  const selectedTab = session.componentId === component?.id ? session.tab : "content";
  const tab = selectedTab === "advanced" && !advanced ? "content" : selectedTab;
  const look = component && componentLook(component);
  const subtitle = component && look
    ? `Appears at ${fmt(component.at)} · ${lookPresetName(look.basePreset)} look${look.preset === "custom" ? " · edited" : ""}`
    : sub;
  const heading = TYPES.find(item => item.type === component?.type)?.name ?? title;
  return <>
    <div className={componentStyles.chrome} {...(disabled ? { inert: "" } : {})}>
      <InspectorHeader title={heading} subtitle={subtitle} kind="component" icon="components"
        onDeselect={dock?.expanded ? () => dock.setExpanded(false) : clearTimelineSelection}
        closeLabel={dock?.expanded ? "Collapse component editor" : undefined} />
    </div>
    <div className={componentStyles.navigation} hidden={dock?.expanded} {...(disabled ? { inert: "" } : {})}>{navigation}</div>
    <div className={`${styles.body} ${componentStyles.body}`} data-authoring-tab={tab} data-expanded={dock?.expanded}>
      {tab === "content" && <h3 className={componentStyles.wording}>Wording</h3>}
      {children}
    </div>
  </>;
}
