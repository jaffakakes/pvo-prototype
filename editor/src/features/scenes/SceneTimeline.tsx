import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useCapture } from "../../state/captureStore";
import { SceneTree } from "./SceneTree";
import { ScenesRow } from "./ScenesRow";
import styles from "./Scenes.module.css";

export function SceneTimeline({ children }: { children: ReactNode }) {
  const scenes = useCapture(state => state.scenes);
  const currentSceneId = useCapture(state => state.currentSceneId);
  const sheetOpen = useCapture(state => state.sheet !== null);
  const trying = useCapture(state => state.tryMode !== null);
  const pickingTime = useCapture(state => state.playheadPick !== null);
  const [treeOpen, setTreeOpen] = useState(false);
  const treeButtonRef = useRef<HTMLButtonElement>(null);
  const treeId = useId();
  const showTree = treeOpen && !sheetOpen && !trying;

  useEffect(() => { setTreeOpen(false); }, [sheetOpen, trying, currentSceneId]);

  const closeTree = () => {
    setTreeOpen(false);
    treeButtonRef.current?.focus({ preventScroll: true });
  };

  return <div className={`sceneTimeline ${styles.timeline}`} data-trying={trying} data-tree-open={showTree}>
    {!trying && <div className={styles.rowSlot} {...(pickingTime ? { inert: "" } : {})}>
      <ScenesRow ref={treeButtonRef} treeOpen={showTree} treeId={treeId}
        onToggleTree={() => setTreeOpen(open => !open)} />
    </div>}
    <div key={currentSceneId} className={styles.lanes} aria-hidden={showTree}
      {...(showTree ? { inert: "" } : {})}>
      {children}
    </div>
    {showTree && <SceneTree id={treeId} scenes={scenes} currentSceneId={currentSceneId}
      onClose={closeTree} onSelect={id => {
        useCapture.getState().switchScene(id);
        closeTree();
      }} />}
  </div>;
}
