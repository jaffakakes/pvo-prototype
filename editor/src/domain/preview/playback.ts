import { componentInteractionAvailable } from "../animation/interaction";
import {
  acceptsResponse,
  responsePolicyFor,
} from "../components/responsePolicy";
import { componentEnd } from "../components/timing";
import type {
  PlaybackOutcome,
  PvoComponent,
  Ratio,
  Scene,
} from "../project/model";
import { clamp } from "../project/numbers";
import { projectRatio } from "../project/ratio";
import { sceneDuration } from "../scenes/duration";
import type { TryMode } from "./model";

type PlaybackScene = Pick<
  Scene,
  "clips" | "audioClips" | "texts" | "components" | "layers"
> & {
  ratio: Ratio;
  t: number;
};

export const freshTryMode = (): TryMode => ({
  playing: true,
  holdingId: null,
  handled: [],
  capturedResponses: {},
  dispatched: [],
});

export function tryInteractionAvailable(
  scene: PlaybackScene,
  component: PvoComponent,
  time: number,
) {
  const [width, height] = projectRatio(scene.ratio);
  return componentInteractionAvailable(scene, component, time, width / height);
}

/** Seeking behind a processed boundary lets its component accept a new response. */
export function resumeTryPlayback(
  scene: PlaybackScene,
  mode: TryMode,
  outcome: Exclude<PlaybackOutcome, { kind: "scene" }>,
) {
  const t =
    outcome.kind === "time"
      ? clamp(outcome.t, 0, sceneDuration(scene))
      : scene.t;
  const keepResponse = (id: string) => {
    const item = scene.components.find((candidate) => candidate.id === id);
    return !!item && componentEnd(item, scene.clips) < t;
  };
  const rewound = t < scene.t;
  return {
    t,
    tryMode: {
      ...mode,
      playing: true,
      holdingId: null,
      handled: rewound ? mode.handled.filter(keepResponse) : mode.handled,
      capturedResponses: rewound
        ? Object.fromEntries(
            Object.entries(mode.capturedResponses).filter(([id]) =>
              keepResponse(id),
            ),
          )
        : mode.capturedResponses,
      dispatched: rewound
        ? mode.dispatched.filter(keepResponse)
        : mode.dispatched,
    },
  };
}

/** Visibility is evaluated at the boundary, including motion between playback frames. */
export function nextTryBoundary(
  scene: PlaybackScene,
  mode: TryMode,
  next: number,
) {
  return scene.components
    .filter((component) => {
      if (!acceptsResponse(component)) return false;
      const policy = responsePolicyFor(component);
      return (
        (policy.dispatch === "layer_end" || policy.unanswered === "pause") &&
        (mode.capturedResponses[component.id] ||
          tryInteractionAvailable(
            scene,
            component,
            componentEnd(component, scene.clips),
          )) &&
        !mode.handled.includes(component.id)
      );
    })
    .map((component) => ({
      component,
      end: componentEnd(component, scene.clips),
    }))
    .filter(({ end }) => end >= scene.t - 0.001 && end <= next + 0.001)
    .sort((a, b) => a.end - b.end)[0];
}
