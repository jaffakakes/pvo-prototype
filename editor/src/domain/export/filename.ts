/** Use the project title for a download while preserving the renderer's actual file type. */
export function exportFilename(projectName: string, renderedName: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(renderedName)?.[1]?.toLowerCase() ?? "mp4";
  const stem = projectName.replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${stem || "restyle-video"}.${extension}`;
}
