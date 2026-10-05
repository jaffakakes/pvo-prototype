import type { TextStyle } from "../../pvo-text-runtime/index.js";
import type { AssistantSource } from "../index.js";
import type {
  AnimationProperty,
  LayerAnimation,
} from "../../pvo-animation/index.js";

export type NativeAnimationTarget =
  | { kind: "clip" | "audio" | "text"; id: number }
  | { kind: "component"; id: string }
  | { kind: "music" };
export type NativeVisualAnimationTarget =
  { kind: "clip" | "text"; id: number } | { kind: "component"; id: string };
export type NativeTrackingTarget =
  { kind: "text"; text: string } | { kind: "point"; x: number; y: number };
/** Box centers and dimensions are normalized to the inspected canvas. */
export type NativeTrackingSample = {
  time: number;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};
export type NativeObjectTrackingObservation = {
  kind: "object_tracking";
  id: string;
  sceneId: string;
  clipId: number;
  start: number;
  end: number;
  model: "sam3.1";
  samples: NativeTrackingSample[];
  frameCount: number;
};

export type NativeMode = "ask" | "plan" | "edit";
export type NativeResponsePolicy = {
  dispatch: "interaction" | "layer_end";
  unanswered: "continue" | "pause";
};
export type NativeTextChanges = {
  text?: string;
  start?: number;
  end?: number;
  x?: number;
  y?: number;
  style?: Partial<TextStyle>;
};
import type {
  FontSummary,
  WebObservationRequest,
  WebObservation,
} from "./webTypes.js";
export type {
  FontSummary,
  WebObservationRequest,
  WebObservation,
} from "./webTypes.js";
export type NativeOperation =
  | {
      kind: "font.apply";
      sceneId: string;
      target: { kind: "component"; id: string } | { kind: "text"; id: number };
      fontId: string | null;
    }
  | {
      kind: "animation.follow";
      sceneId: string;
      target: NativeVisualAnimationTarget;
      observationId: string;
      anchor: "center" | "top";
      offsetX: number;
      offsetY: number;
    }
  | {
      kind: "animation.set";
      sceneId: string;
      target: NativeAnimationTarget;
      tracks: LayerAnimation["tracks"];
    }
  | {
      kind: "animation.remove";
      sceneId: string;
      target: NativeAnimationTarget;
      property: AnimationProperty;
      time: number;
    }
  | {
      kind: "animation.clear";
      sceneId: string;
      target: NativeAnimationTarget;
      property?: AnimationProperty;
    }
  | {
      kind: "text.add";
      sceneId: string;
      text: string;
      start: number;
      end: number;
      x?: number;
      y?: number;
      style?: Partial<TextStyle>;
    }
  | {
      kind: "text.update";
      sceneId: string;
      textId: number;
      changes: NativeTextChanges;
    }
  | { kind: "text.delete"; sceneId: string; textId: number }
  | {
      kind: "clip.trim";
      sceneId: string;
      clipId: number;
      sourceIn: number;
      sourceOut: number;
    }
  | { kind: "clip.split"; sceneId: string; clipId: number; time: number }
  | { kind: "clip.move"; sceneId: string; clipId: number; index: number }
  | {
      kind: "clip.duplicate" | "clip.delete" | "audio.extract";
      sceneId: string;
      clipId: number;
    }
  | {
      kind: "clip.update";
      sceneId: string;
      clipId: number;
      changes: {
        speed?: number;
        zoom?: number;
        mirror?: boolean;
        fit?: "cover" | "contain";
      };
    }
  | {
      kind: "audio.update";
      sceneId: string;
      audioId: number;
      changes: {
        start?: number;
        sourceIn?: number;
        sourceOut?: number;
        muted?: boolean;
        gain?: number;
      };
    }
  | { kind: "audio.split"; sceneId: string; audioId: number; time: number }
  | { kind: "audio.delete"; sceneId: string; audioId: number }
  | { kind: "scene.add"; parentId: string; name: string }
  | {
      kind: "scene.update";
      sceneId: string;
      changes: {
        name?: string;
        muted?: boolean;
        musicGain?: number;
        clipGain?: number;
      };
    }
  | { kind: "scene.duplicate"; sceneId: string }
  | { kind: "scene.delete"; sceneId: string }
  | { kind: "project.ratio"; ratio: "9:16" | "1:1" | "4:5" | "16:9" }
  | {
      kind: "component.add";
      sceneId: string;
      componentType: "tooltip" | "card" | "choice" | "form";
      at: number;
      duration: number | null;
      source?: AssistantSource;
      responsePolicy?: NativeResponsePolicy;
    }
  | {
      kind: "component.update";
      sceneId: string;
      componentId: string;
      changes: {
        at?: number;
        duration?: number | null;
        x?: number;
        y?: number;
        scale?: number;
        scaleX?: number | null;
        scaleY?: number | null;
        width?: number | null;
        height?: number | null;
        responsePolicy?: NativeResponsePolicy;
      };
    }
  | {
      kind: "component.content";
      sceneId: string;
      componentId: string;
      changes: {
        text?: string;
        title?: string;
        body?: string;
        prompt?: string;
        heading?: string;
        submitLabel?: string;
        buttonLabels?: string[];
        optionLabels?: string[];
      };
    }
  | {
      kind: "component.style";
      sceneId: string;
      componentId: string;
      style: string;
    }
  | {
      kind: "component.source";
      sceneId: string;
      componentId: string;
      source: AssistantSource;
    }
  | { kind: "component.delete"; sceneId: string; componentId: string }
  | { kind: "playback.seek"; sceneId: string; time: number }
  | { kind: "playback.play" }
  | { kind: "playback.pause" }
  | { kind: "export.prepare"; format: "video" | "pvo" };
export type NativeObservationRequest =
  | WebObservationRequest
  | {
      kind: "object_tracking";
      sceneId: string;
      clipId: number;
      start: number;
      end: number;
      target: NativeTrackingTarget;
    }
  | {
      kind: "frames";
      sceneId: string;
      start: number;
      end: number;
      count: number;
    }
  | { kind: "transcript"; sceneId: string; start: number; end: number }
  | {
      kind: "word_timing";
      sceneId: string;
      start: number;
      end: number;
      source: AlignmentSource;
      text: string;
      language: "en";
    };
export type AlignmentSource = { kind: "clip" | "audio"; id: number };
export type AlignmentProvenance = {
  method: "forced_alignment";
  engine: "mfa";
  version: string;
  acousticModel: string;
  dictionary: string;
  language: "en";
  transcriptVerified: false;
  refined: boolean;
};
export type WordAlignment = {
  text: string;
  words: { text: string; start: number; end: number }[];
  provenance: AlignmentProvenance;
};
export function normalizedAlignmentWords(text: string): string[];
export function parseWordAlignment(
  value: unknown,
  options: { text: string; duration: number },
): WordAlignment;
export type NativeObservation =
  | WebObservation
  | NativeObjectTrackingObservation
  | {
      kind: "frames";
      sceneId: string;
      start: number;
      end: number;
      frames: {
        sceneTime: number;
        clipId: number | null;
        sourceTime: number | null;
        dataUrl: string;
        width: number;
        height: number;
      }[];
      coverage: "video-and-text";
      note: string;
    }
  | {
      kind: "transcript";
      sceneId: string;
      start: number;
      end: number;
      text: string;
      segments?: { start: number; end: number; text: string }[];
    }
  | {
      kind: "word_timing";
      sceneId: string;
      start: number;
      end: number;
      source: AlignmentSource;
      sourceStart: number;
      sourceEnd: number;
      text: string;
      words: {
        text: string;
        start: number;
        end: number;
        sourceStart: number;
        sourceEnd: number;
      }[];
      provenance: AlignmentProvenance;
    }
  | {
      kind: "unavailable";
      sceneId: string;
      requestedKind:
        "frames" | "transcript" | "word_timing" | "object_tracking";
      message: string;
    };
export type NativeProjectContext = {
  fingerprint: string;
  currentSceneId: string;
  selection: {
    clipId: number | null;
    textId: number | null;
    componentId: string | null;
    audioId: number | null;
  };
  playhead: number;
  ratio: "9:16" | "1:1" | "4:5" | "16:9";
  canvas: { width: number; height: number };
  scenes: {
    id: string;
    name: string;
    parent: string | null;
    duration: number;
    muted: boolean;
    musicGain: number;
    clipGain: number;
    musicAnimation?: LayerAnimation;
    clips: {
      id: number;
      start: number;
      end: number;
      sourceIn: number;
      sourceOut: number;
      sourceDuration: number;
      speed: number;
      zoom: number;
      mirror: boolean;
      fit: "cover" | "contain";
      hasMedia: boolean;
      audioDetached: boolean;
      animation?: LayerAnimation;
    }[];
    texts: {
      id: number;
      text: string;
      start: number;
      end: number;
      x: number;
      y: number;
      style?: Partial<Omit<TextStyle, "fontAsset">>;
      font?: FontSummary;
      animation?: LayerAnimation;
    }[];
    audioClips: {
      id: number;
      name: string;
      start: number;
      end: number;
      sourceIn: number;
      sourceOut: number;
      sourceDuration: number;
      speed: number;
      muted: boolean;
      gain: number;
      animation?: LayerAnimation;
    }[];
    components: ({
      id: string;
      at: number;
      duration: number | null;
      x: number;
      y: number;
      scale: number;
      scaleX: number;
      scaleY: number;
      proportionalScale: number;
      width: number | null;
      height: number | null;
      formFields?: {
        name: string;
        kind: "name" | "email" | "phone" | "short" | "number" | "yesno";
      }[];
      label: string;
      content: Record<string, string>;
      source?: AssistantSource;
      design?: AssistantSource;
      animation?: LayerAnimation;
      font?: FontSummary;
    } & (
      | { type: "tooltip"; responsePolicy?: never }
      | {
          type: "card" | "choice" | "form";
          responsePolicy: NativeResponsePolicy;
        }
    ))[];
  }[];
};
type NativeSceneContext = NativeProjectContext["scenes"][number];
export type NativeEntityReference =
  | { kind: "project" }
  | { kind: "scene"; sceneId: string }
  | { kind: "clip" | "text" | "audio"; sceneId: string; id: number }
  | { kind: "component"; sceneId: string; id: string };
export type NativeEntityState =
  | { kind: "project"; values: Pick<NativeProjectContext, "ratio" | "canvas"> }
  | {
      kind: "scene";
      sceneId: string;
      values: Pick<
        NativeSceneContext,
        | "id"
        | "name"
        | "parent"
        | "duration"
        | "muted"
        | "musicGain"
        | "clipGain"
        | "musicAnimation"
      >;
    }
  | {
      kind: "clip";
      sceneId: string;
      values: NativeSceneContext["clips"][number];
    }
  | {
      kind: "text";
      sceneId: string;
      values: NativeSceneContext["texts"][number];
    }
  | {
      kind: "audio";
      sceneId: string;
      values: NativeSceneContext["audioClips"][number];
    }
  | {
      kind: "component";
      sceneId: string;
      values: Omit<
        NativeSceneContext["components"][number],
        "source" | "design"
      > & { sourceFingerprint: string };
    };
export type NativeScheduledEffect = Extract<
  NativeOperation,
  {
    kind:
      "playback.seek" | "playback.play" | "playback.pause" | "export.prepare";
  }
>;
export type NativePreparationReceipt = {
  operation: NativeOperation["kind"];
  target: NativeEntityReference | null;
  outcome: "prepared" | "unchanged" | "scheduled";
  changes: {
    before: NativeEntityState | null;
    after: NativeEntityState | null;
  }[];
  /** Exact deferred parameters, present only when outcome is scheduled. */
  effect?: NativeScheduledEffect;
};
export type NativeExecutionContext = {
  requestStartFingerprint: string;
  requestStartValues: {
    entity: NativeEntityReference;
    state: NativeEntityState | null;
  }[];
  receipts: NativePreparationReceipt[];
};
export type NativeTurnRequest = {
  mode: NativeMode;
  prompt: string;
  history: { role: "user" | "assistant"; content: string }[];
  project: NativeProjectContext;
  observations: NativeObservation[];
  /** Exact preparation facts for this request; never previous conversation history. */
  execution?: NativeExecutionContext;
};
export type NativeTurnResult = {
  /** A saved planning handoff; it never executes an editor or provider operation. */
  cloudTask?: import("../tasks/index.js").TaskProposal;
  message: string;
  operations: NativeOperation[];
  observations: NativeObservationRequest[];
  /** A genuine blocker ends the task without applying any prepared changes. */
  blocked?: true;
  /** Requested substantive answer accompanying completed edits, on an unblocked terminal result only. */
  answer?: string;
  /** Server-derived sampled-frame descriptions, at most 8000 characters combined. */
  evidence?: string[];
};
export const nativeTurnSchema: Readonly<Record<string, unknown>>;
export function parseNativeOperation(value: unknown): NativeOperation;
export function parseNativeObservation(value: unknown): NativeObservation;
export function parseNativeTurnRequest(value: unknown): NativeTurnRequest;
export function parseNativeTurnResult(value: unknown): NativeTurnResult;

export const TRACKING_MAX_SECONDS: number;
export const TRACKING_FPS: number;
export const TRACKING_MAX_FRAMES: number;
export const TRACKING_MAX_EDGE: number;
export const TRACKING_MAX_FRAME_BYTES: number;
export const TRACKING_MAX_REQUEST_BYTES: number;
export function objectTrackingTimes(start: number, end: number): number[];
export type ObjectTrackingResult = {
  model: "sam3.1";
  width: number;
  height: number;
  frames: NativeTrackingSample[];
};
export function parseObjectTrackingResult(
  value: unknown,
  expected: { width: number; height: number; times: number[] },
): ObjectTrackingResult;
