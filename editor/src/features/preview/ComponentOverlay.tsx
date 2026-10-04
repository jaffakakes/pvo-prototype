import { fontFamily } from "../../../../packages/pvo-fonts/index.js";
import { useAppliedFont } from "./useAppliedFont";
import { evaluateAnimation, visualMotionVisible } from "../../../../packages/pvo-animation/index.js";
import type { CSSProperties } from "react";
import { componentEnd } from "../../domain/components/timing";
import { useComponentDimensions } from "./useComponentDimensions";
import type { Clip,ComponentResponse,PvoComponent } from "../../domain/project/model";
import { cx } from "../../styles";
import { PvoRuntimeOverlay } from "./PvoRuntimeOverlay";
import { ComponentFieldsView } from "./ComponentFieldsView";
import { useComponentAuthoring } from "../../state/components/componentAuthoringStore";
import { TryFeedback } from "./TryFeedback";
import { useDebugLocate } from "../editor-layout/debugging/debugLocate";
import debugStyles from "../editor-layout/debugging/DebugWorkspace.module.css";

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

export function ComponentOverlay({ component, width, selected, trying, onResponse, zIndex, time, focus = null }: {
  component: PvoComponent;
  width: number;
  selected: boolean;
  trying: boolean;
  zIndex: number;
  time: number;
  focus?: { x: number; y: number; zIndex: number } | null;
  onResponse: (component: PvoComponent, response: ComponentResponse) => void;
}) {
  useAppliedFont(component.code?.custom ? undefined : component.font);
  const session = useComponentAuthoring();
  const located = useDebugLocate(state => state.componentId === component.id);
  const u = width / 247;
  const { ref, size } = useComponentDimensions(component, width);
  const motion = evaluateAnimation(component.animation, time - component.at);
  const style = {
    left: `${component.x + motion.x}%`, top: `${component.y + motion.y}%`, zIndex: focus?.zIndex ?? zIndex, "--u": `${u}px`,
    width: "max-content", opacity: focus ? 1 : motion.opacity,
    ...(focus ? { "--focus-origin-x": `${-focus.x}px`, "--focus-origin-y": `${-focus.y}px` } : {}),
    ...(component.font ? { "--component-font": `"${fontFamily(component.font)}"` } : {}),
    visibility: trying && !visualMotionVisible(motion) ? "hidden" : undefined,
    transform: `translate(calc(-50% + ${focus?.x ?? 0}px), calc(-50% + ${focus?.y ?? 0}px)) rotate(${motion.rotation}deg) scale(${size.width * motion.scaleX}, ${size.height * motion.scaleY})`,
  } as CSSProperties;

  return <div ref={ref} className={cx("compOverlay")} data-preview-component={component.id} data-font={component.font ? "applied" : undefined} data-layer-id={`component:${component.id}`} data-sel={selected} data-trying={trying} data-component-focused={!!focus} style={style}>
    {component.code?.custom ? component.code.pvo
      ? <PvoRuntimeOverlay component={component} width={width} trying={trying} isVisible={componentVisible} />
      : <div className={cx("compTooltip")}>Unsupported component code</div>
      : <ComponentFieldsView component={component} unit={u} trying={trying} onResponse={onResponse}
          selectedPart={selected && session.componentId === component.id && session.tab === "look" ? session.part : null} />}
    {trying && <TryFeedback componentId={component.id} />}
    {located && <div className={debugStyles.locate} aria-hidden="true" data-debug-locate>
      <span>{componentLabel(component)}</span>
    </div>}
  </div>;
}
