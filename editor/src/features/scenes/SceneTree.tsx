import { useEffect, useRef } from "react";
import { total } from "../../domain/clips/timing";
import type { Scene } from "../../domain/project/model";
import { sceneChildren, sceneTree } from "../../domain/scenes/rules";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import styles from "./Scenes.module.css";

type Props = {
  id: string;
  scenes: Scene[];
  currentSceneId: string;
  onClose(): void;
  onSelect(id: string): void;
};

export function SceneTree({ id, scenes, currentSceneId, onClose, onSelect }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);

  return <section id={id} className={`sceneTree ${styles.tree}`} aria-labelledby={`${id}-heading`}
    onKeyDown={event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }}>
    <header className={styles.treeHeader}>
      <h2 id={`${id}-heading`}>Scene tree</h2>
      <p>Tap a scene to open it</p>
      <button ref={closeRef} className={styles.close} onClick={onClose} aria-label="Close scene tree">
        <Icon name="close" size={16} />
      </button>
    </header>
    <div className={styles.treeBody}>
      {sceneTree(scenes).map(({ scene, depth }) => {
        const branchCount = sceneChildren(scenes, scene.id).length;
        const componentCount = scene.components.length;
        const current = scene.id === currentSceneId;
        return <button key={scene.id} className={styles.treeNode} data-scene-id={scene.id}
          style={{ paddingLeft: 14 + depth * 18 }} aria-current={current ? "true" : undefined}
          aria-label={`Open ${scene.name}, level ${depth + 1}, ${fmt(total(scene.clips))}, ${branchCount} ${branchCount === 1 ? "branch" : "branches"}, ${componentCount} ${componentCount === 1 ? "component" : "components"}`}
          onClick={() => onSelect(scene.id)}>
          <span className={styles.tick} aria-hidden="true" />
          <span className={styles.nodeChip} data-on={current}>
            {scene.name} <small>{fmt(total(scene.clips))}</small>
          </span>
          <span className={styles.meta}>{branchCount} {branchCount === 1 ? "branch" : "branches"} · {componentCount} {componentCount === 1 ? "component" : "components"}</span>
        </button>;
      })}
    </div>
  </section>;
}
