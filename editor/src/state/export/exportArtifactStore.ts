import { create } from "zustand";
import type { CompletedExport, PublicationReservation } from "../../domain/publishing/model";

type ExportArtifactState = {
  artifact: CompletedExport | null;
  url: string | null;
  attempt: string | null;
  publication: PublicationReservation | null;
  publicationKey: string;
  publicationTitle: string | null;
};
const empty: ExportArtifactState = { artifact: null, url: null, attempt: null, publication: null, publicationKey: "", publicationTitle: null };

// Completed exports are session resources, never part of editable project history or autosave.
export const useExportArtifact = create<ExportArtifactState>(() => ({ ...empty }));
export function beginExportAttempt(snapshotId: string) {
  useExportArtifact.setState({ attempt: snapshotId });
}
export function finishExportAttempt(artifact: CompletedExport, url: string): boolean {
  const current = useExportArtifact.getState();
  if (current.attempt !== artifact.snapshotId) { URL.revokeObjectURL(url); return false; }
  if (current.url && current.url !== url) URL.revokeObjectURL(current.url);
  useExportArtifact.setState({ artifact, url, attempt: null, publication: null, publicationKey: artifact.snapshotId, publicationTitle: null });
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
export function forgetExportPublication(id: string, nextKey: string) {
  if (useExportArtifact.getState().publication?.id === id) useExportArtifact.setState({ publication: null, publicationKey: nextKey, publicationTitle: null });
}
export function resetExportArtifact() {
  const current = useExportArtifact.getState();
  if (current.url) URL.revokeObjectURL(current.url);
  useExportArtifact.setState({ ...empty });
}
