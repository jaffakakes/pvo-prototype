import { createDefaultComponent } from "../../domain/components/editing";
import { uid } from "../../infrastructure/ids";
import { useCapture } from "../captureStore";

/** The scene and its new choice are one undoable edit; existing routes stay intact. */
export function createSceneBranch(): string {
  const before = useCapture.getState();
  const source = before.scenes.find(
    (scene) => scene.id === before.currentSceneId,
  )!;
  const id = before.createScene();
  const state = useCapture.getState();
  const branch = state.scenes.find((scene) => scene.id === id)!;
  const choice = createDefaultComponent(
    `component-${uid()}`,
    "choice",
    source,
    before.t,
  );
  choice.fields.options = [
    { label: branch.name, outcome: { kind: "scene", sceneId: id } },
    { label: "Continue", outcome: { kind: "continue" } },
  ];
  state.patch({
    scenes: state.scenes.map((scene) =>
      scene.id === source.id
        ? { ...scene, components: [...scene.components, choice] }
        : scene,
    ),
  });
  return id;
}
