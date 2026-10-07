import type { NativeOperation, NativePreparationReceipt } from "../../../../../packages/pvo-assistant/native/index.js";
import type { CompiledPvoComponent, PvoLanguageSource } from "../../../../../packages/pvo-language/index.js";
import type { ComponentType, ProjectSnapshot } from "../../project/model";
import type { NativeTrackingEvidence } from "../../animation/trackingEvidence";
import type { AppliedFont } from "../../../../../packages/pvo-fonts/index.js";
import type { ServiceAttachmentAuthorization } from "../../../../../packages/pvo-assistant/attachments/index.js";

export type NativePlaybackOperation = Extract<NativeOperation, { kind: "playback.seek" | "playback.play" | "playback.pause" }>;
export type NativeBatch = {
  before: ProjectSnapshot;
  project: ProjectSnapshot;
  operations: NativeOperation[];
  receipts: NativePreparationReceipt[];
  playback: NativePlaybackOperation[];
  exportFormat: "pvo" | null;
  advancedEditingEnabled: boolean;
  attachment?: {
    authorization: ServiceAttachmentAuthorization;
    sceneId: string;
    componentId: string;
  };
};
export type NativePreparation = {
  fonts?: ReadonlyMap<string, AppliedFont>;
  createId: () => number;
  compile: (type: ComponentType, source: PvoLanguageSource) => Promise<CompiledPvoComponent>;
  advancedEditingEnabled: boolean;
  /** A read-only cancellation flag supplied by the request adapter. */
  signal?: { readonly aborted: boolean };
  /** Only actual completed tools registered by this task can supply tracking coordinates. */
  trackingEvidence?: readonly NativeTrackingEvidence[];
  /** Only authenticated saved-result or owned-Container workflows may supply this separate service receipt. */
  attachment?: ServiceAttachmentAuthorization;
};
