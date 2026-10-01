import type { CSSProperties } from "react";
import { componentEnd } from "../../domain/components/timing";
import { useComponentDimensions } from "./useComponentDimensions";
import type { Clip,ComponentResponse,PvoComponent } from "../../domain/project/model";
import { cx } from "../../styles";
import { PvoRuntimeOverlay } from "./PvoRuntimeOverlay";
import { ComponentFieldsView } from "./ComponentFieldsView";
import { useComponentAuthoring } from "../../state/components/componentAuthoringStore";
import { TryFeedback } from "./TryFeedback";
import styles from "./ProposalOutline.module.css";

export function componentLabel(component: PvoComponent) {
  const structure = component.code?.custom ? component.code.pvoCompiled?.structure : null;
  if (structure?.type === "tooltip") return structure.text.trim() || "Tooltip";
  if (structure?.type === "card") return structure.title?.trim() || structure.body?.trim() || "Card";
  if (structure?.type === "choice") return structure.prompt.trim() || "Choice";
  if (structure?.type === "form") return structure.submit.trim() || "Form";
  const fields = component.fields;
  if (component.type === "tooltip") return fields.text?.trim() || "Tooltip";
  if (component.type === "card") return fields.title?.trim() || "Card";
  if (component.type === "choice") return fields.prompt?.trim() || "Choice";
  return fields.submitLabel?.trim() || "Form";
}

/** A component shows for its layer, and stays while it waits at the layer end for a response. */
export function componentVisible(component: PvoComponent, clips: Clip[], t: number, holdingId: string | null) {
  if (holdingId === component.id) return true;
  return t >= component.at && t < componentEnd(component, clips);
}

export function ComponentOverlay({ component, width, selected, trying, onResponse, zIndex, proposed = false, before = false }: {
  component: PvoComponent;
  width: number;
  selected: boolean;
  trying: boolean;
  zIndex: number;
  proposed?: boolean;
  before?: boolean;
  onResponse: (component: PvoComponent, response: ComponentResponse) => void;
}) {
  const session = useComponentAuthoring();
  const u = width / 247;
  const { ref, size } = useComponentDimensions(component, width);
  const style = {
    left: `${component.x}%`, top: `${component.y}%`, zIndex, "--u": `${u}px`,
    width: "max-content",
    transform: `translate(-50%, -50%) scale(${size.width}, ${size.height})`,
  } as CSSProperties;

  return <div ref={ref} className={`${cx("compOverlay")} ${proposed ? styles.proposed : ""}`} data-proposed={proposed} data-layer-id={`component:${component.id}`} data-sel={selected} data-trying={trying} style={style}>
    {(proposed || before) && <span className={styles.label} data-before={before}>{before ? "Before" : "Proposed"}</span>}
    {component.code?.custom ? component.code.pvo
      ? <PvoRuntimeOverlay component={component} width={width} trying={trying} isVisible={componentVisible}
          immediatePreview={proposed || before} />
      : <div className={cx("compTooltip")}>Unsupported component code</div>
      : <ComponentFieldsView component={component} unit={u} trying={trying} onResponse={onResponse}
          selectedPart={selected && session.componentId === component.id && session.tab === "look" ? session.part : null} />}
    {trying && <TryFeedback componentId={component.id} />}
  </div>;
}
