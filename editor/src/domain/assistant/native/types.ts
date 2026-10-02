import type { NativeOperation, NativePreparationReceipt } from "../../../../../packages/pvo-assistant/native/index.js";
import type { CompiledPvoComponent, PvoLanguageSource } from "../../../../../packages/pvo-language/index.js";
import type { ComponentType, ProjectSnapshot } from "../../project/model";
import type { NativeTrackingEvidence } from "../../animation/trackingEvidence";

export type NativePlaybackOperation = Extract<NativeOperation, { kind: "playback.seek" | "playback.play" | "playback.pause" }>;
export type NativeBatch = {
  before: ProjectSnapshot;
  project: ProjectSnapshot;
  operations: NativeOperation[];
  receipts: NativePreparationReceipt[];
  playback: NativePlaybackOperation[];
  exportFormat: "video" | "pvo" | null;
  advancedEditingEnabled: boolean;
};
export type NativePreparation = {
  createId: () => number;
  compile: (type: ComponentType, source: PvoLanguageSource) => Promise<CompiledPvoComponent>;
  advancedEditingEnabled: boolean;
  /** A read-only cancellation flag supplied by the request adapter. */
  signal?: { readonly aborted: boolean };
  /** Only actual completed tools registered by this task can supply tracking coordinates. */
  trackingEvidence?: readonly NativeTrackingEvidence[];
};
