import { useState } from "react";
import { SceneSwipeRow } from "../../scenes/SceneSwipeRow";
import { SceneActionDialog } from "../../scenes/SceneActionDialog";
import { sceneDuration } from "../../../domain/scenes/duration";
import { sceneTree } from "../../../domain/scenes/rules";
import { useCapture } from "../../../state/captureStore";
import { Icon } from "../../../ui/Icon";
import { fmt } from "../../../ui/formatTime";
import { ClipPoster } from "../../../ui/media/ClipPoster";
import { LibraryHeading } from "./LibraryParts";
import styles from "./Library.module.css";

export function SceneLibrary() {
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [action, setAction] = useState<{
    id: string;
    kind: "rename" | "delete";
  } | null>(null);
  const scenes = useCapture((state) => state.scenes);
  const currentId = useCapture((state) => state.currentSceneId);
  const current = scenes.find((scene) => scene.id === currentId);
  const importing = useCapture((state) => state.importing);
  return (
    <>
      <LibraryHeading count={`${scenes.length} scenes`}>Scenes</LibraryHeading>
      <p className={styles.sceneHint}>Slide left to rename or delete</p>
      <div className={styles.sceneTree}>
        {sceneTree(scenes).map(({ scene, depth }) => (
          <div
            key={scene.id}
            className={styles.sceneBranch}
            style={{ marginLeft: Math.max(0, depth - 1) * 20 }}
          >
            {depth > 0 && <span className={styles.sceneElbow} />}
            <SceneSwipeRow
              scene={scene}
              className={styles.scene}
              disabled={importing}
              active={currentId === scene.id}
              revealed={revealedId === scene.id}
              label={`Open ${scene.name}`}
              onReveal={(open) => setRevealedId(open ? scene.id : null)}
              onAction={(kind) => setAction({ id: scene.id, kind })}
              onOpen={() => useCapture.getState().switchScene(scene.id)}
            >
              <span className={styles.scenePoster}>
                {scene.clips[0] && <ClipPoster clip={scene.clips[0]} />}
              </span>
              <span className={styles.sceneInfo}>
                <strong>{scene.name}</strong>
                <small>
                  {fmt(sceneDuration(scene))} · {scene.clips.length} clips ·{" "}
                  {scene.components.length}{" "}
                  {scene.components.length === 1 ? "component" : "components"}
                </small>
              </span>
              {currentId === scene.id && (
                <span className={styles.editing}>EDITING</span>
              )}
            </SceneSwipeRow>
          </div>
        ))}
      </div>
      <button
        type="button"
        className={styles.importButton}
        disabled={importing}
        onClick={() => useCapture.getState().createScene()}
      >
        <Icon name="plus" size={16} />
        Branch from {current?.name ?? "scene"}
      </button>
      {action && (
        <SceneActionDialog
          key={`${action.id}:${action.kind}`}
          sceneId={action.id}
          action={action.kind}
          onClose={() => setAction(null)}
        />
      )}
    </>
  );
}
