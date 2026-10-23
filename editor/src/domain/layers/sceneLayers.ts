import { audioDuration } from "../audio/editing";
import type { AudioClip } from "../audio/model";
import type { MusicLayer } from "../audio/music";
import { total } from "../clips/timing";
import { componentEnd } from "../components/timing";
import { componentLabel } from "../components/presentation";
import type { Scene, TextOverlay, PvoComponent } from "../project/model";
import { layerOrder } from "./order";
import type { LayerId } from "./model";

type CommonLayer<T extends string, I extends LayerId, V> = {
  id: I;
  type: T;
  label: string;
  start: number;
  end: number;
  visual: boolean;
  value: V;
};
export type SceneLayer =
  | CommonLayer<"video", "video", Scene["clips"]>
  | CommonLayer<"text", `text:${number}`, TextOverlay>
  | CommonLayer<"component", `component:${string}`, PvoComponent>
  | CommonLayer<"audio", `audio:${number}`, AudioClip>
  | CommonLayer<"music", "music", MusicLayer>;
export type SceneLayerSource = Pick<
  Scene,
  "clips" | "texts" | "components" | "layers" | "audioClips" | "music"
>;
/** Type-specific payloads stay with their domain; this is the common timeline contract. */
export function sceneLayers(scene: SceneLayerSource): SceneLayer[] {
  const found: SceneLayer[] = [
    {
      id: "video",
      type: "video",
      label: "Video",
      start: 0,
      end: total(scene.clips),
      visual: true,
      value: scene.clips,
    },
  ];
  for (const text of scene.texts)
    found.push({
      id: `text:${text.id}`,
      type: "text",
      label: text.text || "Text",
      start: text.start,
      end: text.end,
      visual: true,
      value: text,
    });
  for (const component of scene.components)
    found.push({
      id: `component:${component.id}`,
      type: "component",
      label: componentLabel(component),
      start: component.at,
      end: componentEnd(component, scene.clips),
      visual: true,
      value: component,
    });
  for (const audio of scene.audioClips ?? [])
    found.push({
      id: `audio:${audio.id}`,
      type: "audio",
      label: audio.name,
      start: audio.start,
      end: audio.start + audioDuration(audio),
      visual: false,
      value: audio,
    });
  if (scene.music)
    found.push({
      id: "music",
      type: "music",
      label: "Music",
      start: scene.music.start,
      end: scene.music.start + scene.music.duration,
      visual: false,
      value: scene.music,
    });
  const byId = new Map(found.map((layer) => [layer.id, layer]));
  return layerOrder(scene).flatMap((id) =>
    byId.has(id) ? [byId.get(id)!] : [],
  );
}
