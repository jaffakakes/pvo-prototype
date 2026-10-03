import type { AppliedFont } from "../../../../packages/pvo-fonts/index.js";
import type { CompiledPvoComponent } from "../../../../packages/pvo-language/index.js";
import { type TextStyle } from "../../../../packages/pvo-text-runtime/index.js";
import { type PvoLanguageSource } from "../components/languageSource";
import { type LayerId } from "../layers/model";
import type { ComponentLook } from "../components/look";
import type { AudioClip } from "../audio/model";
import type { LayerAnimation } from "../animation/model";
import type { LayerTracking } from "../animation/trackingMetadata";

export type Clip = {
  id: number;
  url: string | null;
  color: string;
  srcDur: number;
  in: number;
  out: number;
  speed: number;
  zoom: number;
  mirror: boolean;
  width: number;
  height: number;
  fit: "cover" | "contain";
  audioDetached?: boolean;
  /** Media animation uses original-source seconds, preserving motion through trim/split/speed edits. */
  animation?: LayerAnimation;
  animationTracking?: LayerTracking;
};
export type TextOverlay = {
  id: number;
  text: string;
  color: number;
  start: number;
  end: number;
  x: number;
  y: number;
  style?: TextStyle;
  /** Animation seconds are relative to this layer's start. */
  animation?: LayerAnimation;
  animationTracking?: LayerTracking;
};
export type Ratio = "9:16" | "1:1" | "4:5" | "16:9";
export type ComponentType = "tooltip" | "card" | "choice" | "form";
export type PlaybackOutcome = {
  kind: "continue";
} | {
  kind: "time";
  t: number;
} | {
  kind: "scene";
  sceneId: string;
};
export type Outcome = PlaybackOutcome | {
  kind: "request";
  url: string;
  method: "GET" | "POST";
  body: string;
  onSuccess: PlaybackOutcome;
  onError: PlaybackOutcome | null;
};
export type ComponentResponse = {
  index: number;
  outcome: Outcome;
  formValues?: Record<string, string | number | boolean>;
};
export type FormField = { name: string; type: "text" | "number" | "yesno" };
export type ResponsePolicy = {
  /** When the captured response is handed to Logic and its authored action runs. */
  dispatch: "interaction" | "layer_end";
  /** What playback does at the layer end when no response has been captured. */
  unanswered: "continue" | "pause";
};
export type ComponentFields = {
  text?: string;
  title?: string;
  body?: string;
  buttons?: {
    label: string;
    outcome?: Outcome;
  }[];
  prompt?: string;
  options?: {
    label: string;
    outcome: Outcome;
  }[];
  fieldKinds?: ("name" | "email" | "phone" | "short" | "yesno")[];
  formFields?: FormField[];
  formSubmitMode?: "local" | "request";
  heading?: string;
  destination?: string;
  waitingLabel?: string;
  successOutcome?: PlaybackOutcome;
  failureOutcome?: PlaybackOutcome | null;
  submitLabel?: string;
  outcome?: Outcome;
};
export type PvoComponent = {
  id: string;
  type: ComponentType;
  sceneId: string;
  at: number;
  /** Seconds on screen; null shows the component until its clip ends. */
  dur: number | null;
  /** Required for interactive components; absent only on display-only Notes. */
  responsePolicy?: ResponsePolicy;
  x: number;
  y: number;
  scale?: number;
  /** Independent scale factors; absent axes inherit the legacy uniform scale. */
  scaleX?: number;
  scaleY?: number;
  /** Canvas pixels at a 1080px short edge, before uniform pinch scale. */
  width?: number;
  height?: number;
  look?: ComponentLook;
  /** Downloaded font bytes travel with this layer and its project history. */
  font?: AppliedFont;
  /** Animation seconds are relative to this layer's at time. */
  animation?: LayerAnimation;
  animationTracking?: LayerTracking;
  fields: ComponentFields;
  /** Last code-owned version kept when returning to visual editing. */
  archivedCode?: PvoComponent["code"];
  code?: {
    custom: boolean;
    pvo?: PvoLanguageSource;
    /** Last accepted source, retained while an Advanced draft is unfinished. */
    pvoLastValid?: PvoLanguageSource;
    pvoTouched?: boolean;
    /** Literal Structure no longer expands legacy Fields placeholders. */
    pvoLiteral?: boolean;
    pvoCompiled?: Pick<CompiledPvoComponent, "structure" | "rules">;
  };
};
export type Scene = {
  id: string;
  name: string;
  parent: string | null;
  clips: Clip[];
  audioClips?: AudioClip[];
  texts: TextOverlay[];
  components: PvoComponent[];
  muted: boolean;
  sound: number;
  musicGain?: number;
  clipGain?: number;
  /** Background music gain curves use scene seconds. */
  musicAnimation?: LayerAnimation;
  layers?: LayerId[];
};
export type OutcomeTarget = {
  kind: "button" | "option" | "form";
  index?: number;
};
export type ProjectSnapshot = {
  scenes: Scene[];
  currentSceneId: string;
  ratio: Ratio;
  allowedDomains: string[];
};
