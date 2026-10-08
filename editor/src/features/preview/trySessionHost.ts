import type { TryServiceHost } from "./createTryServiceRequests";
import type { CaptureState } from "../../state/types";
import type { PvoRequestFailure } from "../../../../packages/pvo-sdk/index.js";
import type { TryDiagnosticSink } from "./createTryDiagnostics";

export type TrySessionState = Pick<
  CaptureState,
  | "currentSceneId"
  | "localId"
  | "t"
  | "sel"
  | "selComp"
  | "selText"
  | "sheet"
  | "scenes"
  | "clips"
  | "components"
  | "texts"
  | "layers"
  | "ratio"
  | "allowedDomains"
  | "tryMode"
  | "patch"
  | "switchScene"
>;
export type TrySessionHost = {
  diagnostics?: TryDiagnosticSink;
  services?: TryServiceHost;
  getState(): TrySessionState;
  request: typeof fetch;
  publishRuntimeState(state: Record<string, unknown> | null): void;
  feedback(): Record<string, { phase: string }>;
  clearFeedback(): void;
  clearNotice(): void;
  startFailed(): void;
  playbackFailed(): void;
  emptyScene(id: string): void;
  beginRequest(id: string): number;
  finishRequest(
    id: string,
    operation: number,
    failed: boolean,
    failure?: PvoRequestFailure,
  ): void;
};
