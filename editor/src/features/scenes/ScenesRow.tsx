import { forwardRef, useEffect, useRef } from "react";
import { sceneDuration } from "../../domain/scenes/duration";
import { sceneChildren } from "../../domain/scenes/rules";
import { useCapture } from "../../state/captureStore";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { DebugEntry } from "../editor-layout/debugging/DebugEntry";
import styles from "./Scenes.module.css";

type Props = {
  treeOpen: boolean;
  treeId: string;
  onToggleTree(): void;
};

export const ScenesRow = forwardRef<HTMLButtonElement, Props>(function ScenesRow({ treeOpen, treeId, onToggleTree }, treeButtonRef) {
  const scenes = useCapture(state => state.scenes);
  const currentSceneId = useCapture(state => state.currentSceneId);
  const stripRef = useRef<HTMLDivElement>(null);
  const current = scenes.find(scene => scene.id === currentSceneId);
  const parent = scenes.find(scene => scene.id === current?.parent);
  const children = sceneChildren(scenes, currentSceneId);

  useEffect(() => {
    if (stripRef.current) stripRef.current.scrollLeft = 0;
  }, [currentSceneId]);

  if (!current) return null;

  return <nav className={`scenesRow ${styles.row}`} aria-label="Scenes">
    <div ref={stripRef} className={styles.strip}>
      {parent && <button className={`sceneChip ${styles.chip} ${styles.parent}`}
        aria-label={`Up to the parent scene: ${parent.name}`}
        onClick={() => useCapture.getState().switchScene(parent.id)}>
        <span aria-hidden="true">↑</span> {parent.name}
      </button>}
      <span className={`sceneChip ${styles.chip}`} aria-current="true" data-on="true">
        {current.name} <small>{fmt(sceneDuration(current))}</small>
      </span>
      {children.length > 0 && <span className={styles.separator} aria-hidden="true">›</span>}
      {children.map(scene => {
        const branchCount = sceneChildren(scenes, scene.id).length;
        return <button key={scene.id} className={`sceneChip ${styles.chip}`}
          aria-label={`Open ${scene.name}`} onClick={() => useCapture.getState().switchScene(scene.id)}>
          {scene.name} <small>{fmt(sceneDuration(scene))}</small>
          {branchCount > 0 && <span className={styles.branchCount}
            aria-label={`${branchCount} ${branchCount === 1 ? "branch" : "branches"}`}>▸{branchCount}</span>}
        </button>;
      })}
      <button className={`sceneAdd ${styles.chip} ${styles.add}`}
        aria-label="New scene branching from here" onClick={() => useCapture.getState().createScene()}>
        <Icon name="plus" size={13} /> Scene
      </button>
    </div>
    <button ref={treeButtonRef} className={styles.treeButton} aria-label="Show the whole scene tree"
      aria-expanded={treeOpen} aria-controls={treeId} onClick={onToggleTree}>
      <Icon name="choice" size={19} />
    </button>
    <DebugEntry variant="lastRun" />
  </nav>;
});
