import type { SceneNode } from "../../domain/scenes/graph";
import { fmt } from "../../ui/formatTime";
import { ScenePoster } from "./ScenePoster";
import { SceneSwipeRow } from "./SceneSwipeRow";
import styles from "./ScenesPanel.module.css";

type Props = {
  node: SceneNode;
  active: boolean;
  revealed: boolean;
  onReveal(open: boolean): void;
  onOpen(): void;
  onAction(action: "rename" | "delete"): void;
};

export function SceneTreeRow({
  node,
  active,
  revealed,
  onReveal,
  onOpen,
  onAction,
}: Props) {
  const status = active
    ? "Currently editing"
    : !node.scene.clips.length
      ? "No content yet"
      : node.children.length
        ? `${node.children.length} ${node.children.length === 1 ? "branch" : "branches"}`
        : "";
  const route = node.reachedBy[0];
  const choice = route
    ? `Choice: ${route.label}${node.reachedBy.length > 1 ? ` +${node.reachedBy.length - 1}` : ""}`
    : "";
  return (
    <SceneSwipeRow
      scene={node.scene}
      active={active}
      revealed={revealed}
      onReveal={onReveal}
      onOpen={onOpen}
      onAction={onAction}
      label={`Open ${node.scene.name}, level ${node.depth + 1}, ${status || fmt(node.duration)}${choice ? `, reached by ${choice}` : ""}`}
    >
      <ScenePoster scene={node.scene} />
      <span className={styles.name}>{node.scene.name}</span>
      {!!node.scene.clips.length && !active && (
        <span className={styles.duration}>{fmt(node.duration)}</span>
      )}
      {choice && (
        <span className={styles.pill} title={choice}>
          {choice}
        </span>
      )}
      {status && (
        <span className={styles.status}>
          {active && <i />}
          {status}
        </span>
      )}
    </SceneSwipeRow>
  );
}
