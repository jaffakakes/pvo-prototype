import { useEffect, useState } from "react";
import type { ExportFormat, ExportStage } from "../../domain/publishing/model";
import type { Scene } from "../../domain/project/model";
import { exportProgress } from "./presentation";

export function useExportProgress(
  running: boolean,
  scenes: Scene[],
  format: ExportFormat,
  percent: number,
  stage: ExportStage | null,
) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (!running) return;
    const beginning = Date.now();
    const timer = window.setInterval(
      () => setElapsed((Date.now() - beginning) / 1000),
      500,
    );
    return () => clearInterval(timer);
  }, [running]);
  return exportProgress(scenes, format, percent, stage, elapsed);
}
