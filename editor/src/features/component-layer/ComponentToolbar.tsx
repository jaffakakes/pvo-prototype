import { useEditorTransition } from "../../ui/motion/EditorMotion";
import { cx } from "../../styles";
import type { PvoComponent } from "../../domain/project/model";
import { isVisualEditingBlocked } from "../../domain/components/codeOwnership";
import { componentTypeName } from "../../domain/components/presentation";
import { useCapture } from "../../state/captureStore";
import {
  openComponentDesign,
  openComponentLayerTool,
  type ComponentLayerTool,
} from "../../state/components/componentLayerCommands";
import { ComponentToolIcon } from "./ComponentToolIcon";
import styles from "./ComponentLayer.module.css";

export function ComponentToolbar({ component }: { component: PvoComponent }) {
  const transition = useEditorTransition();
  const tools = [
    { id: "design", label: "Design", icon: "edit" },
    { id: "opacity", label: "Opacity", icon: "opacity" },
    { id: "transform", label: "Transform", icon: "expand" },
    { id: "timing", label: "Timing", icon: "timer" },
    { id: "duplicate", label: "Duplicate", icon: "duplicate" },
    { id: "delete", label: "Delete", icon: "delete" },
  ];
  const act = (id: string) => {
    if (id === "design") transition("component", openComponentDesign);
    else if (id === "duplicate")
      useCapture.getState().duplicateComponent(component.id);
    else if (id === "delete")
      useCapture.getState().deleteComponent(component.id);
    else
      transition(id === "timing" ? "frame" : "tool", () =>
        openComponentLayerTool(id as ComponentLayerTool),
      );
  };
  return (
    <div
      className={`${cx("toolBar")} ${styles.toolbar}`}
      role="toolbar"
      aria-label={`${componentTypeName(component)} tools`}
      data-component-tools
    >
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={styles.tile}
          data-tool={tool.id}
          aria-label={tool.label}
          onClick={() => act(tool.id)}
        >
          <ComponentToolIcon name={tool.icon} />
          <span>{tool.label}</span>
          {tool.id === "design" && isVisualEditingBlocked(component) && (
            <span
              className={styles.errorDot}
              role="img"
              aria-label="Code needs attention"
            />
          )}
        </button>
      ))}
    </div>
  );
}
