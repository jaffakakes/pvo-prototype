import type { CompletedExport } from "../../domain/publishing/model";

function exportedFile(artifact: CompletedExport): File {
  return new File([artifact.blob], artifact.filename, { type: artifact.contentType });
}
export function canShareExport(artifact: CompletedExport): boolean {
  try { return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [exportedFile(artifact)] }); }
  catch { return false; }
}
export async function shareExportFile(artifact: CompletedExport): Promise<void> {
  if (!canShareExport(artifact)) throw new Error("File sharing isn’t supported here.");
  await navigator.share({ files: [exportedFile(artifact)] });
}
export function cancelledShare(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function copyPublicationLink(url: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
  await navigator.clipboard.writeText(url);
}
