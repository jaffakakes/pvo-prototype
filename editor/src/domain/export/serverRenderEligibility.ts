import { layerOrder } from "../layers/order";
import type { Scene } from "../project/model";

type ServerScene = Pick<Scene, "clips" | "audioClips" | "clipGain" | "musicGain" | "musicAnimation" |
  "sound" | "texts" | "components" | "layers"> & {
  includeText?: boolean;
  includeVideoAnimation?: boolean;
};

/** The server's first renderer must never silently omit visible authored effects or change the audio mix. */
export function canRenderSceneOnServer(source: ServerScene): boolean {
  if (source.sound !== 0 || (source.clipGain !== undefined && source.clipGain !== 1)
    || (source.musicGain !== undefined && source.musicGain !== 1) || source.musicAnimation) return false;
  if (source.clips.some(clip => clip.animation && Object.entries(clip.animation.tracks).some(
    ([property, frames]) => frames?.length && (property === "gain" || source.includeVideoAnimation !== false),
  ))) return false;
  if (source.audioClips?.some(clip => (clip.gain !== undefined && clip.gain !== 1) || clip.animation)) return false;
  // PVO packages carry native text/fonts and visual motion in their manifest;
  // only their deliberately plain scene media is sent to the renderer.
  if (source.includeText === false) return true;
  const layers = layerOrder(source);
  const videoIndex = layers.indexOf("video");
  return !layers.slice(videoIndex + 1).some((id) =>
    id.startsWith("text:") && source.texts.some((text) =>
      id === `text:${text.id}` && text.end > Math.max(0, text.start),
    ),
  );
}
