import { useEffect, useRef } from "react";
import { sceneChildren } from "../../../domain/scenes/rules";
import { useCapture } from "../../../state/captureStore";
import styles from "./DesktopSceneBar.module.css";

export function DesktopSceneBar({ onOpenTree }: { onOpenTree(): void }) {
  const scenes = useCapture(state => state.scenes);
  const sceneId = useCapture(state => state.currentSceneId);
  const trying = useCapture(state => !!state.tryMode);
  const importing = useCapture(state => state.importing);
  const current = scenes.find(scene => scene.id === sceneId);
  const parent = scenes.find(scene => scene.id === current?.parent);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { if (strip.current) strip.current.scrollLeft = 0; }, [sceneId]);

  return <nav className={styles.bar} aria-label="Scenes">
    <span className={styles.label}>Scene</span>
    <div className={styles.strip} ref={strip}>
      {parent && <button type="button" className={styles.chip} disabled={trying || importing}
        onClick={() => useCapture.getState().switchScene(parent.id)} aria-label={`Up to the parent scene: ${parent.name}`}>
        ↑ {parent.name}
      </button>}
      <span className={`${styles.chip} ${styles.current}`} aria-current="true">{current?.name}</span>
      {sceneChildren(scenes, sceneId).length > 0 && <span className={styles.separator}>›</span>}
      {sceneChildren(scenes, sceneId).map(scene => <button type="button" key={scene.id} className={styles.chip}
        disabled={trying || importing} onClick={() => useCapture.getState().switchScene(scene.id)} aria-label={`Open ${scene.name}`}>
        <i />{scene.name}
      </button>)}
      <button type="button" className={`${styles.chip} ${styles.add}`} disabled={trying || importing}
        onClick={() => useCapture.getState().createScene()} aria-label="New scene branching from here">＋ Scene</button>
    </div>
    <button type="button" className={styles.tree} onClick={onOpenTree} aria-label="Show the whole scene tree">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 3h5v5H3zM16 10h5v5h-5zM16 18h5v3h-5zM5 8v11h11M5 12h11" />
      </svg>
    </button>
  </nav>;
}
