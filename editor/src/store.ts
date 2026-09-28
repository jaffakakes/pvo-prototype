// Stable editor state API; implementation is grouped by responsibility.
export { CLIP_COLORS } from "./domain/clips/defaults";
export type {
  Clip,
  ComponentFields,
  ComponentType,
  Outcome,
  OutcomeTarget,
  PlaybackOutcome,
  ProjectSnapshot,
  PvoComponent,
  Ratio,
  Scene,
  TextOverlay,
} from "./domain/project/model";
export { RATIOS, projectRatio } from "./domain/project/ratio";
export { SOUNDS } from "./features/sound/catalog";
export { TEXT_COLORS } from "./features/text/catalog";
export { uid } from "./infrastructure/ids";
export { useCapture } from "./state/captureStore";
export { mkClip } from "./state/editing/clipFactory";
export type {
  CaptureState,
  PlayheadPick,
  SheetName,
  TryMode,
} from "./state/types";
