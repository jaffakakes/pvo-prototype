import type { ExportFormat, ExportStage } from "../../domain/publishing/model";
import type { Scene } from "../../domain/project/model";
import { sceneDuration } from "../../domain/scenes/duration";

export type ExportView =
  "setup" | "gate" | "picker" | "exporting" | "done" | "failed";

export function exportClock(seconds: number, tenths = true) {
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60);
  const whole = Math.floor(value % 60);
  return `${minutes}:${String(whole).padStart(2, "0")}${tenths ? `.${Math.floor((value * 10) % 10)}` : ""}`;
}

export function exportView(
  status: string,
  gate: boolean,
  failure: string | null,
  picking: boolean,
): ExportView {
  if (status === "running") return "exporting";
  if (status === "done") return "done";
  if (gate) return "gate";
  if (failure) return "failed";
  return picking ? "picker" : "setup";
}

/** Progress is an estimate over the rendered scene durations, not a second render-job state. */
export function exportProgress(
  scenes: Scene[],
  format: ExportFormat,
  percent: number,
  renderStage: ExportStage | null,
  elapsed: number,
) {
  const main = scenes.find((scene) => scene.id === "main");
  const duration =
    format === "pvo"
      ? scenes.reduce((sum, scene) => sum + sceneDuration(scene), 0)
      : main
        ? sceneDuration(main)
        : 0;
  const progress = Math.min(100, Math.max(0, percent));
  const stage =
    renderStage === "activating"
      ? 3
      : renderStage === "preparing" || renderStage === "uploading"
        ? 0
        : renderStage === "downloading" || progress >= 96
          ? 2
          : 1;
  let sceneNumber = 1;
  if (format === "pvo" && duration > 0) {
    let boundary = 0;
    const renderedSeconds = (duration * progress) / 100;
    for (const [index, scene] of scenes.entries()) {
      boundary += sceneDuration(scene);
      sceneNumber = index + 1;
      if (renderedSeconds < boundary) break;
    }
  }
  const eta =
    progress > 4 && elapsed > 0
      ? Math.max(0, (elapsed * (100 - progress)) / progress)
      : duration;
  return {
    progress,
    stage,
    sceneNumber,
    sceneCount: format === "pvo" ? scenes.length : 1,
    eta,
    duration,
  };
}
