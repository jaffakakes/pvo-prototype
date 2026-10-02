import { type TextStyle } from "../../../packages/pvo-text-runtime/index.js";
import type { AudioClip } from "../domain/audio/model";
import { type LayerId } from "../domain/layers/model";
import type { Clip, ComponentResponse, ComponentType, Outcome, OutcomeTarget, ProjectSnapshot, PvoComponent, Ratio, Scene, TextOverlay } from "../domain/project/model";

export type TryMode = {
  playing: boolean;
  /** Interactive component waiting at the end of its layer for a response. */
  holdingId: string | null;
  /** Components whose response boundary has already been processed in this scene. */
  handled: string[];
  /** Responses captured locally; layer-end responses have not reached Logic yet. */
  capturedResponses: Record<string, ComponentResponse>;
  /** Responses already handed to Logic, used to prevent duplicate requests. */
  dispatched: string[];
};
export type PlayheadPick = ({
  kind: "component-at";
  componentId: string;
} | {
  kind: "outcome-time";
  componentId: string;
  target: OutcomeTarget;
  branch: "success" | "error" | null;
} | {
  kind: "text-start";
  textId: number;
}) & {
  sceneId: string;
  originalT: number;
  error?: string;
};
export type SheetName = null | "speed" | "crop" | "text" | "sound" | "more" | "export" | "discard" | "components" | "component" | "animation";
export type OverlayUpdateOptions = {
  /** A reversible drag preview keeps its magnetic playhead fixed until commit. */
  preservePlayhead?: boolean;
};
export type CaptureState = {
  localId: string | null;
  projectName: string;
  screen: "camera" | "editor";
  recording: boolean;
  importing: boolean;
  elapsed: number;
  camOn: boolean;
  facing: "user" | "environment";
  flash: boolean;
  timer: 0 | 3 | 10;
  countdown: number;
  recSpeed: .3 | .5 | 1 | 2 | 3;
  speedRow: boolean;
  replacing: number | null;
  scenes: Scene[];
  currentSceneId: string;
  // These are mirrors of the active scene, retained for the existing camera/editor APIs.
  clips: Clip[];
  audioClips: AudioClip[];
  texts: TextOverlay[];
  components: PvoComponent[];
  muted: boolean;
  sound: number;
  layers: LayerId[];
  ratio: Ratio;
  allowedDomains: string[];
  recordingInto: string | null;
  sel: number;
  selComp: string | null;
  selText: number | null;
  selAudio: number | null;
  t: number;
  playing: boolean;
  trim: {
    i: number;
    side: "l" | "r";
    shift: number;
    lt: number;
  } | null;
  orb: boolean;
  tryMode: TryMode | null;
  playheadPick: PlayheadPick | null;
  sheet: SheetName;
  ratioMenu: boolean;
  draft: string;
  tColor: number;
  exportFormat: "video" | "pvo";
  quality: "720p" | "1080p";
  ex: "idle" | "running" | "done";
  exPct: number;
  exUrl: string | null;
  exName: string;
  past: ProjectSnapshot[];
  future: ProjectSnapshot[];
  patch: (values: Partial<CaptureState>) => void;
  edit: (values: Partial<CaptureState>) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  switchScene: (id: string, options?: {
    undoable?: boolean;
    preserveTry?: boolean;
  }) => void;
  createScene: (options?: {
    name?: string;
    openCamera?: boolean;
  }) => string;
  deleteScene: (id: string) => void;
  duplicateScene: (id: string) => string | null;
  startRecordingIntoScene: (id: string) => void;
  cancelRecordingIntoScene: () => void;
  updateScene: (id: string, changes: Partial<Omit<Scene, "id">>, undoable?: boolean) => void;
  addComponent: (type: ComponentType) => string;
  updateComponent: (id: string, changes: Partial<PvoComponent>, undoable?: boolean, options?: OverlayUpdateOptions) => void;
  updateOutcome: (id: string, target: OutcomeTarget, outcome: Outcome, undoable?: boolean) => boolean;
  deleteComponent: (id: string) => void;
  duplicateComponent: (id: string) => string | null;
  reorderLayer: (id: LayerId, direction: "up" | "down") => void;
  addText: (text: string, style?: TextStyle) => number;
  updateText: (id: number, changes: Partial<TextOverlay>, undoable?: boolean, options?: OverlayUpdateOptions) => void;
  deleteText: (id: number) => void;
  duplicateText: (id: number) => void;
};
