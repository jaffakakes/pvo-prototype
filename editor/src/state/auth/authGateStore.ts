import { create } from "zustand";
import type { PublishingStatus } from "../../domain/publishing/model";
import type { ExportFormat } from "../../domain/publishing/model";
import { useCapture } from "../captureStore";
import { isWideLayout } from "../../infrastructure/viewport";

type AuthGateState = { source: "export" | "signin" | null; status: PublishingStatus | null };
export const useAuthGate = create<AuthGateState>(() => ({ source: null, status: null }));

export function openSignIn() { useAuthGate.setState({ source: "signin" }); }
export function closeAuthGate() { useAuthGate.setState({ source: null }); }
export function continueToExport() {
  closeAuthGate();
  useCapture.getState().patch({ sheet: "export", playing: false, orb: false });
}

/** Header and settings use the same export entry command. */
export function requestExport(format?: ExportFormat) {
  if (format) useCapture.getState().patch({ exportFormat: format });
  if (!isWideLayout()) { continueToExport(); return; }
  useAuthGate.setState({ source: "export" });
}
