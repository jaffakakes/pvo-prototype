import { audioDuration } from "../audio/editing";
import { total } from "../clips/timing";
import { componentEnd } from "../components/timing";
import type { Scene } from "../project/model";

export type SceneDurationSource = Pick<
  Scene,
  "clips" | "audioClips" | "texts" | "components"
>;

const finiteEnd = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

/** The full authored timeline, including media and explicit visual tails. */
export function sceneDuration(scene: SceneDurationSource): number {
  return Math.max(
    finiteEnd(total(scene.clips)),
    ...(scene.audioClips ?? []).map((clip) =>
      finiteEnd(clip.start + audioDuration(clip)),
    ),
    ...scene.texts.map((text) => finiteEnd(text.end)),
    ...scene.components.map((component) =>
      finiteEnd(componentEnd(component, scene.clips)),
    ),
  );
}
