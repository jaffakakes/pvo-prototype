import {
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent,
} from "react";
import type { SceneNode } from "../../domain/scenes/graph";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { ScenePoster } from "./ScenePoster";
import styles from "./ScenesPanel.module.css";

type Props = {
  nodes: SceneNode[];
  currentId: string;
  onOpen(id: string): void;
  onAdd(): void;
  onManage(id: string): void;
};

export function SceneTreeList({
  nodes,
  currentId,
  onOpen,
  onAdd,
  onManage,
}: Props) {
  const hold = useRef<ReturnType<typeof setTimeout>>();
  const pressed = useRef<{ x: number; y: number; fired: boolean }>();
  const cancelHold = () => clearTimeout(hold.current);
  useEffect(() => cancelHold, []);
  const current = nodes.find((node) => node.scene.id === currentId)!;
  const rows: (SceneNode | null)[] = [...nodes];
  const currentIndex = rows.indexOf(current);
  let addIndex = currentIndex + 1;
  while (addIndex < nodes.length && nodes[addIndex].depth > current.depth)
    addIndex++;
  rows.splice(addIndex, 0, null);
  const indexes = new Map(
    rows.flatMap((node, index) =>
      node ? [[node.scene.id, index] as const] : [],
    ),
  );
  const startHold = (event: PointerEvent, id: string) => {
    cancelHold();
    pressed.current = { x: event.clientX, y: event.clientY, fired: false };
    if (event.pointerType !== "mouse" && id !== "main")
      hold.current = setTimeout(() => {
        if (pressed.current) pressed.current.fired = true;
        onManage(id);
      }, 550);
  };
  return (
    <div
      className={styles.rows}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
        ];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : Math.max(
                  0,
                  Math.min(
                    buttons.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                );
        event.preventDefault();
        buttons[next]?.focus();
      }}
    >
      {rows.map((node, index) => {
        const parent = node?.scene.parent ?? (node ? null : currentId);
        const distance = parent ? index - (indexes.get(parent) ?? index) : 0;
        const connector = parent && (
          <span
            className={styles.elbow}
            aria-hidden="true"
            style={{ "--rows-back": distance } as CSSProperties}
          />
        );
        if (!node)
          return (
            <button
              key="add"
              className={styles.addRow}
              style={{ marginLeft: (current.depth + 1) * 18 }}
              onClick={onAdd}
            >
              {connector}
              <Icon name="plus" size={12} />
              Add a branch to {current.scene.name}
            </button>
          );
        const active = node.scene.id === currentId;
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
          <button
            key={node.scene.id}
            className={styles.node}
            data-scene-id={node.scene.id}
            style={{ marginLeft: node.depth * 18 }}
            aria-current={active ? "true" : undefined}
            aria-label={`Open ${node.scene.name}, level ${node.depth + 1}, ${status || fmt(node.duration)}${choice ? `, reached by ${choice}` : ""}`}
            onPointerDown={(event) => startHold(event, node.scene.id)}
            onPointerUp={cancelHold}
            onPointerCancel={cancelHold}
            onPointerMove={(event) => {
              if (
                pressed.current &&
                Math.hypot(
                  event.clientX - pressed.current.x,
                  event.clientY - pressed.current.y,
                ) > 8
              )
                cancelHold();
            }}
            onContextMenu={(event) => {
              if (node.scene.id !== "main") {
                event.preventDefault();
                cancelHold();
                onManage(node.scene.id);
              }
            }}
            onClick={() => {
              if (!pressed.current?.fired) onOpen(node.scene.id);
              pressed.current = undefined;
            }}
          >
            {connector}
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
          </button>
        );
      })}
    </div>
  );
}
