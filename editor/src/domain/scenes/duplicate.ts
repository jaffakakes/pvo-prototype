import type { LayerId } from "../layers/model";
import { layerOrder } from "../layers/order";
import type { Scene } from "../project/model";
import { cloneScenes } from "../project/snapshot";
import { remapComponentReferences } from "../components/requestReferences";

/** A duplicate is a sibling with independent editable data and shared media URLs. */
export function duplicateSceneData(scene: Scene, scenes: readonly Scene[], id: string, nextId: () => number): Scene {
  const copy = cloneScenes([scene])[0];
  const layers = new Map<LayerId, LayerId>();
  copy.id = id;
  copy.parent = scene.parent ?? "main";
  let name = `${scene.name} copy`;
  for (let ordinal = 2; scenes.some(item => item.parent === copy.parent && item.name === name); ordinal += 1)
    name = `${scene.name} copy ${ordinal}`;
  copy.name = name;
  copy.clips = copy.clips.map(clip => ({ ...clip, id: nextId() }));
  if (copy.audioClips) copy.audioClips = copy.audioClips.map(clip => ({ ...clip, id: nextId() }));
  copy.texts = copy.texts.map(text => {
    const textId = nextId();
    layers.set(`text:${text.id}`, `text:${textId}`);
    return { ...text, id: textId };
  });
  const componentIds = new Map(copy.components.map(component => [component.id, `component-${nextId()}`]));
  copy.components = copy.components.map(component => {
    const componentId = componentIds.get(component.id)!;
    layers.set(`component:${component.id}`, `component:${componentId}`);
    return { ...remapComponentReferences(component, componentIds), id: componentId, sceneId: id };
  });
  copy.layers = layerOrder(scene).map(layer => layers.get(layer) ?? layer);
  return copy;
}
