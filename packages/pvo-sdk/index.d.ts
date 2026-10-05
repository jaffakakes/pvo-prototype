export const PVO_SPEC_VERSION: "0.1-prototype";
export const PVO_MANIFEST_LIMIT: number;
export const PVO_UUID: "5a125a6e-8c7a-4ba8-9dd9-5e449a275056";
export const PVO_CONTAINER_MIME: "application/vnd.pvo";
export const PVO_CONTAINER_VERSION: 1;

export type BinaryInput = Blob | ArrayBuffer | Uint8Array | ArrayBufferView;
export type Scalar = string | number | boolean | null;
export type JsonValue = Scalar | JsonValue[] | { [key: string]: JsonValue };

export interface PvoCondition {
  key?: string;
  response?: string;
  source?: "state" | "response";
  path?: string;
  is?: unknown;
  not?: unknown;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  in?: unknown[];
  exists?: boolean;
  all?: PvoCondition[];
  any?: PvoCondition[];
}

export interface ActionBase { when?: PvoCondition }
export type PvoAction =
  | (ActionBase & { type: "show" | "hide"; component: string | PvoComponent })
  | (ActionBase & { type: "set"; key: string; value?: JsonValue; add?: number })
  | (ActionBase & { type: "goto_scene"; scene: string })
  | (ActionBase & { type: "seek"; scene?: string; time?: number })
  | (ActionBase & { type: "request"; method?: string; url: string; headers?: Record<string, string>; body?: JsonValue; into?: string; on_success?: PvoAction | PvoAction[]; on_error?: PvoAction | PvoAction[] })
  | (ActionBase & { type: "open_url"; url: string })
  | (ActionBase & { type: "chain"; actions: PvoAction[] })
  | (ActionBase & { type: "branch"; cases: Array<{ when: PvoCondition; then: PvoAction | PvoAction[] }>; else?: PvoAction | PvoAction[] })
  | (ActionBase & { type: "custom"; name: string; payload?: JsonValue; into?: string });

export interface PvoScene {
  id: string;
  label?: string;
  /** Tree ownership. Omitted in legacy flat manifests; the root has no parent. */
  parent?: string | null;
  asset_id?: string;
  start: number;
  end: number;
  next?: string;
  on_enter?: PvoAction | PvoAction[];
  on_exit?: PvoAction | PvoAction[];
}

export interface PvoChoiceOption { label: string; value?: JsonValue; action?: PvoAction; actions?: PvoAction[] }
export interface PvoFormField { name: string; label?: string; type?: "text" | "number" | "email" | "choice"; required?: boolean; placeholder?: string; default?: JsonValue; options?: Array<{ label: string; value?: JsonValue }> }
/**
 * Controls when a viewer response reaches its authored action and what playback
 * does if the component reaches the end of its presentation without a response.
 */
export interface PvoResponsePolicy {
  dispatch: "interaction" | "layer_end";
  unanswered: "continue" | "pause";
}
export interface PvoPresentation {
  scene: string;
  clip?: string;
  timeline?: string;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Embedded fonts are deduplicated package assets, never remote download URLs. */
export interface PvoFontReference { asset_id: string }

export interface PvoComponentBase {
  id: string;
  title?: string;
  text?: string;
  presentation?: PvoPresentation;
  position?: { x: number; y: number };
  options?: PvoChoiceOption[];
  fields?: PvoFormField[];
  actions?: Array<{ label: string; action?: PvoAction; actions?: PvoAction[] }>;
  on_submit?: PvoAction | PvoAction[];
  submit_label?: string;
  success_text?: string;
  [key: string]: unknown;
}
export type PvoComponent = PvoComponentBase & (
  | { kind: "tooltip"; response_policy?: never }
  | { kind: "card" | "choice" | "form"; presentation: PvoPresentation; response_policy: PvoResponsePolicy }
);

export interface PvoHotspot { id: string; label?: string; scene?: string; start?: number; end?: number; x: number; y: number; width: number; height: number; actions: PvoAction | PvoAction[] }
export interface PvoTrigger { id?: string; scene?: string; at: number; actions: PvoAction | PvoAction[] }
export interface PvoMedia { id: string; asset_id?: string; name?: string; type?: string }
export interface PvoTimelineClip { id: string; source_clip?: string; asset_id: string; scene?: string; start: number; end: number }
export interface PvoTimeline { id: string; kind?: "main" | "branch"; clips: PvoTimelineClip[] }
export interface PvoPlayback { initial_timeline: string; timelines: PvoTimeline[] }
export interface PvoPoster { asset_id: string; at: number; type: "image/webp" | "image/png" }
export interface PvoManifest {
  spec_version: string;
  id?: string;
  title?: string;
  initial_scene?: string;
  /** Exact hosts (including a port when used) authorized for request actions. Omission permits no requests. */
  allowed_domains?: string[];
  state?: { initial?: Record<string, JsonValue>; persist?: boolean };
  media?: PvoMedia[];
  poster?: PvoPoster;
  playback?: PvoPlayback;
  scenes: PvoScene[];
  components: PvoComponent[];
  hotspots?: PvoHotspot[];
  triggers?: PvoTrigger[];
  [key: string]: unknown;
}

export interface ValidationResult { valid: boolean; errors: string[]; warnings: string[] }
export interface Mp4Box { offset: number; size: number; headerSize: number; type: string; uuidOffset: number; payloadOffset: number; extendsToEnd: boolean }
export interface PvoAssetInput { id: string; name?: string; type?: string; file?: BinaryInput; blob?: BinaryInput; data?: BinaryInput }
export interface PvoAsset { id: string; name: string; type: string; blob: Blob; size: number }
export interface PvoReadResult { manifest: PvoManifest; validation: ValidationResult; videoBlob: Blob; fileName: string; assets?: PvoAsset[]; container?: boolean }
export interface PvoProjectReadResult { manifest: PvoManifest; validation: ValidationResult; assets: PvoAsset[]; container: true; fileName: string }
export interface RuntimeContext { state: Record<string, unknown>; response?: unknown; [key: string]: unknown }
export interface PvoRequestFailure {
  kind: "http" | "network" | "timeout" | "policy" | "unknown";
  status?: number;
  message: string;
}
export type PvoDiagnosticType =
  | "session.started" | "session.stopped" | "session.failed"
  | "component.ready" | "component.failed" | "component.unavailable" | "component.active" | "component.inactive" | "component.no_action"
  | "interaction.received" | "interaction.accepted" | "interaction.ignored" | "response.deferred"
  | "action.selected" | "action.started" | "action.completed" | "action.skipped" | "action.failed" | "action.cancelled"
  | "request.started" | "request.completed" | "request.failed" | "request.rejected" | "request.cancelled"
  | "state.changed"
  | "playback.hold" | "playback.released" | "playback.seek_requested" | "playback.scene_requested" | "playback.route_failed"
  | "media.play_requested" | "media.playing" | "media.paused" | "media.waiting" | "media.seeking" | "media.ended" | "media.error" | "media.play_rejected";
export interface PvoDiagnosticSource {
  part?: "structure" | "style" | "logic";
  revision?: string;
  ruleId?: string;
  line?: number;
  column?: number;
  lastValid?: boolean;
}
export type PvoDiagnosticValue = null | boolean | number | string | PvoDiagnosticValue[] | { [key: string]: PvoDiagnosticValue };
/** Facts only. Hosts attach run identity, sequence and media time in their bounded collectors. */
export interface PvoDiagnosticEvent {
  type: PvoDiagnosticType;
  componentId?: string;
  sceneId?: string;
  interactionId?: string;
  actionId?: string;
  parentActionId?: string;
  requestId?: string;
  source?: PvoDiagnosticSource;
  reason?: string;
  message?: string;
  actionType?: string;
  target?: string;
  label?: string;
  waitUntil?: number;
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  failure?: PvoRequestFailure;
  handled?: boolean;
  path?: string;
  before?: PvoDiagnosticValue;
  after?: PvoDiagnosticValue;
  captured?: boolean;
  requestBody?: PvoDiagnosticValue;
  responseBody?: PvoDiagnosticValue;
}
export interface PvoDiagnosticContext {
  interactionId?: string;
  sceneId?: string;
  actionId?: string;
  source?: PvoDiagnosticSource;
}
export interface RuntimeExecutionContext {
  /** Reject request failures after on_error; intended for imperative pvo.request() bridges. */
  throwOnRequestError?: boolean;
  /** Cancels pending work before it can update state or run follow-up actions. */
  signal?: AbortSignal;
  diagnostic?: PvoDiagnosticContext;
  [key: string]: unknown;
}
export interface RuntimeHandlers {
  show?(component: PvoComponent, context: RuntimeContext): unknown | Promise<unknown>;
  hide?(component: PvoComponent | string, context: RuntimeContext): unknown | Promise<unknown>;
  gotoScene?(scene: string, context: RuntimeContext): unknown | Promise<unknown>;
  seek?(time: number, context: RuntimeContext): unknown | Promise<unknown>;
  request?(request: { url: string; method: string; headers: Record<string, string>; body?: string; redirect: "error"; signal?: AbortSignal }, context: RuntimeContext): unknown | Promise<unknown>;
  openUrl?(url: string, context: RuntimeContext): unknown | Promise<unknown>;
  custom?(name: string, payload: unknown, context: RuntimeContext): unknown | Promise<unknown>;
  onEvent?(event: RuntimeEvent): void;
  /** Optional observer; exceptions and rejected promises cannot change execution. */
  onDiagnostic?(event: PvoDiagnosticEvent): void;
  /** Opt in for subsequent bounded data capture. Secrets and string values remain masked. */
  captureDiagnosticBodies?(): boolean;
}
export interface RuntimeEvent { type: string; state: Record<string, unknown>; visible: string[]; failure?: PvoRequestFailure; [key: string]: unknown }

export function inspectMp4(input: Uint8Array | ArrayBuffer): Mp4Box[];
export function packPvo(media: BinaryInput, manifest: PvoManifest): Promise<Blob>;
export function packPvoProject(project: { manifest: PvoManifest; assets: PvoAssetInput[] }): Promise<Blob>;
export function readPvoProject(file: BinaryInput & { name?: string }): Promise<PvoProjectReadResult>;
export function inspectPvoProject(source: {
  size: number;
  readRange(start: number, end: number): Promise<Uint8Array>;
}, options?: { maxHeaderBytes?: number }): Promise<{
  manifest: PvoManifest;
  validation: ValidationResult;
  assets: Array<{ id: string; name: string; type: string; offset: number; length: number }>;
  payloadStart: number;
}>;
export function readPvo(file: BinaryInput & { name?: string }): Promise<PvoReadResult>;
export function tryReadPvo(file: BinaryInput & { name?: string }): Promise<PvoReadResult | null>;
export function validatePvo(manifest: unknown): ValidationResult;
export function evaluateWhen(condition: PvoCondition | PvoCondition[] | undefined, context?: Partial<RuntimeContext>): boolean;
export function resolveTemplates<T>(value: T, context?: Partial<RuntimeContext>): T;
/** Resolve a display template to scalar text; missing, null, and structured values become empty text. */
export function resolveTextTemplate(value: unknown, context?: Partial<RuntimeContext>): string;
/** Classify a request failure without exposing exception text to viewers. */
export function describeRequestFailure(error: unknown): PvoRequestFailure;
export function sanitizeDiagnosticValue(value: unknown, path?: string): PvoDiagnosticValue;
export function sanitizeDiagnosticUrl(value: unknown): string;
export function sanitizeDiagnosticText(value: unknown): string;
export function observeDiagnostic(observer: ((event: PvoDiagnosticEvent) => void) | undefined, event: PvoDiagnosticEvent): void;

export class PvoRuntime {
  constructor(manifest: PvoManifest, handlers?: RuntimeHandlers);
  manifest: PvoManifest;
  handlers: RuntimeHandlers;
  state: Record<string, unknown>;
  visible: Set<string>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  setState(key: string, value: unknown, context?: RuntimeExecutionContext): void;
  reset(): void;
  getComponent(idOrObject: string | PvoComponent): PvoComponent | undefined;
  execute(actionOrActions: PvoAction | PvoAction[], context?: RuntimeExecutionContext): Promise<unknown>;
}
export function createPvoRuntime(manifest: PvoManifest, handlers?: RuntimeHandlers): PvoRuntime;
