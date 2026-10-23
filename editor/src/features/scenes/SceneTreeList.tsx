import { useState, type CSSProperties } from "react";
import type { SceneNode } from "../../domain/scenes/graph";
import { Icon } from "../../ui/Icon";
import { SceneTreeRow } from "./SceneTreeRow";
import styles from "./ScenesPanel.module.css";

type Props = {
  nodes: SceneNode[];
  currentId: string;
  onOpen(id: string): void;
  onAdd(): void;
  onAction(id: string, action: "rename" | "delete"): void;
};

export function SceneTreeList({
  nodes,
  currentId,
  onOpen,
  onAdd,
  onAction,
}: Props) {
  const [revealedId, setRevealedId] = useState<string | null>(null);
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
  return (
    <div
      className={styles.rows}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "[data-scene-id], [data-add-scene]",
          ),
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
              type="button"
              key="add"
              data-add-scene
              className={styles.addRow}
              style={{ marginLeft: (current.depth + 1) * 18 }}
              onClick={onAdd}
            >
              {connector}
              <Icon name="plus" size={12} />
              Add a branch to {current.scene.name}
            </button>
          );
        return (
          <div
            key={node.scene.id}
            className={styles.sceneRow}
            style={{ marginLeft: node.depth * 18 }}
          >
            {connector}
            <SceneTreeRow
              node={node}
              active={node.scene.id === currentId}
              revealed={revealedId === node.scene.id}
              onReveal={(open) => setRevealedId(open ? node.scene.id : null)}
              onOpen={() => onOpen(node.scene.id)}
              onAction={(action) => onAction(node.scene.id, action)}
            />
          </div>
        );
      })}
    </div>
  );
}
