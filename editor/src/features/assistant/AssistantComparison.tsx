import { createPortal } from "react-dom";
import type { ProjectSnapshot } from "../../domain/project/model";
import { ExportPreview } from "../export/ExportPreview";
import styles from "./AssistantComparison.module.css";

/** Reuse the read-only frame renderer without touching project state or autosave. */
export function AssistantComparison({
  project,
  sceneId,
  time,
  target,
}: {
  project: ProjectSnapshot;
  sceneId: string;
  time: number;
  target: HTMLElement;
}) {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) return null;
  return createPortal(
    <div
      className={styles.preview}
      data-assistant-before
      aria-label="Before this change"
    >
      <ExportPreview
        scene={scene}
        ratio={project.ratio}
        mode="picker"
        pickerTime={time}
        onPickerTime={() => {}}
        artifact={null}
        artifactUrl={null}
        coverOnly
      />
    </div>,
    target,
  );
}
