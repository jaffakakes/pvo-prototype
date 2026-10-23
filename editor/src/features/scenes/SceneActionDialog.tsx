import { useEffect, useId, useRef, useState } from "react";
import { deletionImpact } from "../../domain/scenes/references";
import { sceneSubtreeIds } from "../../domain/scenes/rules";
import { useCapture } from "../../state/captureStore";
import styles from "./SceneActionDialog.module.css";

export function SceneActionDialog({
  sceneId,
  action,
  onClose,
}: {
  sceneId: string;
  action: "rename" | "delete";
  onClose(): void;
}) {
  const scenes = useCapture((state) => state.scenes);
  const scene = scenes.find((item) => item.id === sceneId);
  const [name, setName] = useState(scene?.name ?? "");
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLInputElement>("input")?.select();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLElement>('.sceneTree [aria-current="true"]')
          ?.focus({ preventScroll: true });
    };
  }, []);
  if (!scene || scene.id === "main") return null;
  const impact = action === "delete" ? deletionImpact(scenes, scene.id) : [];
  const deletedIds =
    action === "delete" ? sceneSubtreeIds(scenes, scene.id) : new Set<string>();
  const subtree = scenes.filter((item) => deletedIds.has(item.id));
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={headingId}
      aria-describedby={action === "delete" ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {action === "rename" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            if (name.trim() !== scene.name)
              useCapture
                .getState()
                .updateScene(scene.id, { name: name.trim() });
            onClose();
          }}
        >
          <h2 id={headingId}>Rename scene</h2>
          <label>
            Scene name
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={!name.trim()}>
              Save name
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.content}>
          <h2 id={headingId}>Delete {scene.name}?</h2>
          <p id={descriptionId}>
            {subtree.length > 1
              ? `This removes ${scene.name} and its ${subtree.length - 1} descendant scene${subtree.length === 2 ? "" : "s"}.`
              : "This removes the scene and its content."}{" "}
            You can undo this.
          </p>
          {subtree.length > 1 && (
            <ul aria-label="Scenes to delete">
              {subtree.map((item) => (
                <li key={item.id}>{item.name}</li>
              ))}
            </ul>
          )}
          {impact.length > 0 && (
            <>
              <p>These outcomes will change to Continue:</p>
              <ul aria-label="Affected components">
                {impact.map((item) => (
                  <li key={item.componentId}>
                    <strong>{item.componentName}</strong> · {item.sceneName}
                    <span>{item.outcomes.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className={styles.actions}>
            <button type="button" autoFocus onClick={onClose}>
              Keep scene
            </button>
            <button
              type="button"
              className={styles.danger}
              onClick={() => {
                useCapture.getState().deleteScene(scene.id);
                onClose();
              }}
            >
              Delete scene
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
