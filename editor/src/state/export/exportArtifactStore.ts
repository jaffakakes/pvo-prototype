import { create } from "zustand";
import type { CompletedExport, ExportStage, PublicationReservation } from "../../domain/publishing/model";

type ExportArtifactState = {
  artifact: CompletedExport | null;
  url: string | null;
  attempt: string | null;
  renderStage: ExportStage | null;
  renderMethod: "server" | "browser" | "mixed" | null;
  renderController: AbortController | null;
  publication: PublicationReservation | null;
  publicationKey: string;
  publicationTitle: string | null;
};
const empty: ExportArtifactState = { artifact: null, url: null, attempt: null, renderStage: null, renderMethod: null,
  renderController: null,
  publication: null, publicationKey: "", publicationTitle: null };

// Completed exports are session resources, never part of editable project history or autosave.
export const useExportArtifact = create<ExportArtifactState>(() => ({ ...empty }));
export function beginExportAttempt(snapshotId: string, controller: AbortController | null = null) {
  useExportArtifact.setState({ attempt: snapshotId, renderStage: "preparing", renderMethod: null,
    renderController: controller });
}
export function setExportRenderStage(snapshotId: string, stage: ExportStage) {
  const current = useExportArtifact.getState();
  if (current.attempt !== snapshotId) return;
  const path = stage === "browser" ? "browser" : stage === "preparing" ? null : "server";
  const renderMethod = path && current.renderMethod && path !== current.renderMethod
    ? "mixed" : path ?? current.renderMethod;
  useExportArtifact.setState({ renderStage: stage, renderMethod });
}
export function cancelExportAttempt(snapshotId?: string) {
  const current = useExportArtifact.getState();
  if (!current.attempt || !current.renderController || (snapshotId && snapshotId !== current.attempt)) return false;
  current.renderController.abort(new DOMException("Cancelled", "AbortError"));
  useExportArtifact.setState({ attempt: null, renderStage: null, renderMethod: null, renderController: null });
  return true;
}
export function discardExportAttempt(snapshotId: string) {
  if (useExportArtifact.getState().attempt === snapshotId)
    useExportArtifact.setState({ attempt: null, renderStage: null, renderMethod: null, renderController: null });
}
export function finishExportAttempt(artifact: CompletedExport, url: string): boolean {
  const current = useExportArtifact.getState();
  if (current.attempt !== artifact.snapshotId) { URL.revokeObjectURL(url); return false; }
  if (current.url && current.url !== url) URL.revokeObjectURL(current.url);
  useExportArtifact.setState({ artifact, url, attempt: null, renderStage: null, renderController: null,
    publication: null, publicationKey: artifact.snapshotId, publicationTitle: null });
  return true;
}
export function setExportPublication(snapshotId: string, publication: PublicationReservation, publicationKey?: string) {
  const current = useExportArtifact.getState();
  if (current.artifact?.snapshotId === snapshotId && (publicationKey === undefined || current.publicationKey === publicationKey))
    useExportArtifact.setState({ publication });
}
export function beginPublicationAttempt(snapshotId: string, title: string) {
  const current = useExportArtifact.getState();
  if (current.artifact?.snapshotId === snapshotId && current.publicationTitle === null) useExportArtifact.setState({ publicationTitle: title });
}
export function expirePublicationAttempt(snapshotId: string, publicationKey: string, nextKey: string) {
  const current = useExportArtifact.getState();
  if (current.artifact?.snapshotId === snapshotId && current.publicationKey === publicationKey)
    useExportArtifact.setState({ publication: null, publicationKey: nextKey });
}
export function forgetExportPublication(id: string, nextKey: string) {
  if (useExportArtifact.getState().publication?.id === id) useExportArtifact.setState({ publication: null, publicationKey: nextKey, publicationTitle: null });
}
export function clearAccountPublication() {
  useExportArtifact.setState({ publication: null, publicationKey: crypto.randomUUID(), publicationTitle: null });
}
export function resetExportArtifact() {
  const current = useExportArtifact.getState();
  current.renderController?.abort(new DOMException("Project changed", "AbortError"));
  if (current.url) URL.revokeObjectURL(current.url);
  useExportArtifact.setState({ ...empty });
}
