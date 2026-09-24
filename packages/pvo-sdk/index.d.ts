export const PVO_SPEC_VERSION: "0.1-prototype";
export const PVO_MANIFEST_LIMIT: number;
export const PVO_UUID: "5a125a6e-8c7a-4ba8-9dd9-5e449a275056";

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
  start: number;
  end: number;
  next?: string;
  on_enter?: PvoAction | PvoAction[];
  on_exit?: PvoAction | PvoAction[];
}

export interface PvoChoiceOption { label: string; value?: JsonValue; action?: PvoAction; actions?: PvoAction[] }
export interface PvoFormField { name: string; label?: string; type?: "text" | "number" | "email" | "choice"; required?: boolean; placeholder?: string; default?: JsonValue; options?: Array<{ label: string; value?: JsonValue }> }
export interface PvoSceneChange { enabled: boolean; executeAt: "end"; routes: Array<{ condition: "true" | "false"; sceneId: string }> }
export interface PvoComponent {
  id: string;
  kind: "tooltip" | "card" | "choice" | "form";
  title?: string;
  text?: string;
  pause?: boolean;
  position?: { x: number; y: number };
  options?: PvoChoiceOption[];
  fields?: PvoFormField[];
  actions?: Array<{ label?: string; action?: PvoAction; actions?: PvoAction[] }>;
  on_submit?: PvoAction | PvoAction[];
  submit_label?: string;
  success_text?: string;
  scene_change?: PvoSceneChange;
  [key: string]: unknown;
}

export interface PvoHotspot { id: string; label?: string; scene?: string; start?: number; end?: number; x: number; y: number; width: number; height: number; actions: PvoAction | PvoAction[] }
export interface PvoTrigger { id?: string; scene?: string; at: number; actions: PvoAction | PvoAction[] }
export interface PvoManifest {
  spec_version: string;
  id?: string;
  title?: string;
  initial_scene?: string;
  allowed_domains?: string[];
  state?: { initial?: Record<string, JsonValue>; persist?: boolean };
  scenes: PvoScene[];
  components: PvoComponent[];
  hotspots?: PvoHotspot[];
  triggers?: PvoTrigger[];
  [key: string]: unknown;
}

export interface ValidationResult { valid: boolean; errors: string[]; warnings: string[] }
export interface Mp4Box { offset: number; size: number; headerSize: number; type: string; uuidOffset: number; payloadOffset: number; extendsToEnd: boolean }
export interface PvoReadResult { manifest: PvoManifest; validation: ValidationResult; videoBlob: Blob; fileName: string }
export interface RuntimeContext { state: Record<string, unknown>; response?: unknown; [key: string]: unknown }
export interface RuntimeHandlers {
  show?(component: PvoComponent, context: RuntimeContext): unknown | Promise<unknown>;
  hide?(component: PvoComponent | string, context: RuntimeContext): unknown | Promise<unknown>;
  gotoScene?(scene: string, context: RuntimeContext): unknown | Promise<unknown>;
  seek?(time: number, context: RuntimeContext): unknown | Promise<unknown>;
  request?(request: { url: string; method: string; headers: Record<string, string>; body?: string }, context: RuntimeContext): unknown | Promise<unknown>;
  openUrl?(url: string, context: RuntimeContext): unknown | Promise<unknown>;
  custom?(name: string, payload: unknown, context: RuntimeContext): unknown | Promise<unknown>;
  onEvent?(event: RuntimeEvent): void;
}
export interface RuntimeEvent { type: string; state: Record<string, unknown>; visible: string[]; [key: string]: unknown }

export function inspectMp4(input: Uint8Array | ArrayBuffer): Mp4Box[];
export function packPvo(media: BinaryInput, manifest: PvoManifest): Promise<Blob>;
export function readPvo(file: BinaryInput & { name?: string }): Promise<PvoReadResult>;
export function tryReadPvo(file: BinaryInput & { name?: string }): Promise<PvoReadResult | null>;
export function validatePvo(manifest: unknown): ValidationResult;
export function evaluateWhen(condition: PvoCondition | PvoCondition[] | undefined, context?: Partial<RuntimeContext>): boolean;
export function resolveTemplates<T>(value: T, context?: Partial<RuntimeContext>): T;

export class PvoRuntime {
  constructor(manifest: PvoManifest, handlers?: RuntimeHandlers);
  manifest: PvoManifest;
  handlers: RuntimeHandlers;
  state: Record<string, unknown>;
  visible: Set<string>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  setState(key: string, value: unknown): void;
  reset(): void;
  getComponent(idOrObject: string | PvoComponent): PvoComponent | undefined;
  execute(actionOrActions: PvoAction | PvoAction[], context?: Record<string, unknown>): Promise<unknown>;
}
export function createPvoRuntime(manifest: PvoManifest, handlers?: RuntimeHandlers): PvoRuntime;
