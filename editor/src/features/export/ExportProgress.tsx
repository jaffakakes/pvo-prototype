import type {
  ExportFormat,
  ExportQuality,
} from "../../domain/publishing/model";
import { exportClock, type exportProgress } from "./presentation";
import styles from "./ExportSheet.module.css";

function StageRows({
  stage,
  format,
  scene,
  count,
}: {
  stage: number;
  format: "video" | "pvo";
  scene: number;
  count: number;
}) {
  const rows = [
    ["Preparing media", "Checking clips, audio and fonts"],
    [
      `Rendering scene ${scene} of ${count}`,
      "Building video from the original media",
    ],
    [
      "Packaging file",
      format === "pvo"
        ? "Bundling scenes, components and cover into .pvo"
        : "Muxing video and audio",
    ],
  ];
  return (
    <div className={styles.stages} aria-live="polite">
      {rows.map(([name, detail], index) => (
        <div
          key={index}
          className={styles.stage}
          data-status={
            index < stage ? "done" : index === stage ? "active" : "pending"
          }
        >
          <span className={styles.stageIcon} aria-hidden="true">
            {index < stage ? "✓" : index === stage ? <i /> : ""}
          </span>
          <span>
            <strong>{name}</strong>
            <small>{detail}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

type Props = ReturnType<typeof exportProgress> & {
  format: ExportFormat;
  quality: ExportQuality;
  coverAt: number;
};

export function ExportProgress({
  progress,
  stage,
  sceneNumber,
  sceneCount,
  eta,
  format,
  quality,
  coverAt,
}: Props) {
  return (
    <>
      <div className={styles.progressHeading}>
        <strong>{progress}%</strong>
        <span>about {exportClock(eta, false)} left</span>
      </div>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-label="Export progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <i style={{ width: `${progress}%` }} />
        <b style={{ left: "15%" }} />
        <b style={{ left: "90%" }} />
      </div>
      <span className={styles.progressAnnouncement} aria-live="polite">
        {Math.floor(progress / 10) * 10}% ·{" "}
        {stage === 0
          ? "Preparing media"
          : stage === 1
            ? `Rendering scene ${sceneNumber} of ${sceneCount}`
            : "Packaging file"}
      </span>
      <StageRows
        stage={stage}
        format={format}
        scene={sceneNumber}
        count={sceneCount}
      />
      <p className={styles.keepOpen}>
        <b>!</b>
        <span>
          <strong>Keep this tab open.</strong>
          <span className={styles.desktopOnly}>
            {" "}
            Your export continues if you pause the preview.
          </span>
          <span className={styles.phoneOnly}>
            {" "}
            · about {exportClock(eta, false)} left
          </span>
        </span>
      </p>
      <div className={styles.locked}>
        ♙ {format === "pvo" ? ".pvo" : "Video"} · {quality} · Cover{" "}
        {exportClock(coverAt, false)}
      </div>
    </>
  );
}
