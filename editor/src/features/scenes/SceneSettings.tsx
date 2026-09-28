import { useState } from "react";
import { deletionImpact } from "../../domain/scenes/references";
import { sceneSubtreeIds } from "../../domain/scenes/rules";
import { useCapture } from "../../state/captureStore";
import styles from "./SceneSettings.module.css";

/** Scene management lives inside the existing More sheet. */
export function SceneSettings() {
  const scenes = useCapture(state => state.scenes);
  const currentSceneId = useCapture(state => state.currentSceneId);
  const scene = scenes.find(item => item.id === currentSceneId);
  const [mode, setMode] = useState<"menu" | "rename" | "delete">("menu");
  const [name, setName] = useState(scene?.name ?? "");
  if (!scene || scene.id === "main") return null;

  const impact = mode === "delete" ? deletionImpact(scenes, scene.id) : [];
  const deletedIds = mode === "delete" ? sceneSubtreeIds(scenes, scene.id) : new Set<string>();
  const subtree = scenes.filter(item => deletedIds.has(item.id));
  return <section className={styles.section} aria-label="Current scene settings">
    {mode === "menu" && <>
      <h3>{scene.name}</h3>
      <button type="button" onClick={() => { setName(scene.name); setMode("rename"); }}>Rename scene…</button>
      <button type="button" onClick={() => useCapture.getState().duplicateScene(scene.id)}>Duplicate scene</button>
      <button type="button" className={styles.danger} onClick={() => setMode("delete")}>Delete scene…</button>
    </>}
    {mode === "rename" && <form className={styles.form} onSubmit={event => {
      event.preventDefault();
      if (!name.trim()) return;
      if (name.trim() !== scene.name) useCapture.getState().updateScene(scene.id, { name: name.trim() });
      setMode("menu");
    }}>
      <h3>Rename scene</h3>
      <label>Scene name<input autoFocus value={name} onChange={event => setName(event.target.value)} /></label>
      <div className={styles.actions}>
        <button type="button" onClick={() => setMode("menu")}>Cancel</button>
        <button type="submit" disabled={!name.trim()}>Save name</button>
      </div>
    </form>}
    {mode === "delete" && <div className={styles.confirm}>
      <h3>Delete {scene.name}?</h3>
      <p>{subtree.length > 1 ? `This removes ${scene.name} and its ${subtree.length - 1} descendant scene${subtree.length === 2 ? "" : "s"}.` : "This removes the scene and its content."} You can undo this.</p>
      {subtree.length > 1 && <ul aria-label="Scenes to delete">{subtree.map(item => <li key={item.id}>{item.name}</li>)}</ul>}
      {impact.length ? <>
        <p>These outcomes will change to Continue:</p>
        <ul aria-label="Affected components">{impact.map(item => <li key={item.componentId}>
          <strong>{item.componentName}</strong> · {item.sceneName}<span>{item.outcomes.join(", ")}</span>
        </li>)}</ul>
      </> : <p>No other components route to these scenes.</p>}
      <div className={styles.actions}>
        <button type="button" autoFocus onClick={() => setMode("menu")}>Keep scene</button>
        <button type="button" className={styles.danger} onClick={() => useCapture.getState().deleteScene(scene.id)}>Delete scene</button>
      </div>
    </div>}
  </section>;
}
