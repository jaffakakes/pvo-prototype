import type { ExportQuality } from "../../domain/publishing/model";
import { estimatedExportBytes } from "../../domain/export/quality";
import { formatFileSize } from "../publishing/SharePanel";
import { exportClock } from "./presentation";
import styles from "./ExportSheet.module.css";

type Props = {
  quality: ExportQuality;
  totalDuration: number;
  width: number;
  height: number;
  coverAt: number;
  coverImage: string | null;
  emptyScenes: string[];
  onQuality(quality: ExportQuality): void;
  onChooseCover(): void;
};

export function ExportSettings({
  quality,
  totalDuration,
  width,
  height,
  coverAt,
  coverImage,
  emptyScenes,
  onQuality,
  onChooseCover,
}: Props) {
  const allDuration = totalDuration;
  const approximateSize = formatFileSize(
    estimatedExportBytes(allDuration, quality),
  );
  return (
    <>
      <p className={styles.qualityNote}>
        Export keeps choices, forms and branching, then creates a shareable
        Restyle link.
      </p>
      <section
        className={styles.section}
        aria-labelledby="export-quality-label"
      >
        <h3 id="export-quality-label">Quality</h3>
        <div
          className={styles.quality}
          role="radiogroup"
          aria-label="Export quality"
        >
          {(["720p", "1080p", "4K"] as const).map((optionQuality) => (
            <button
              key={optionQuality}
              type="button"
              role="radio"
              aria-checked={quality === optionQuality}
              data-selected={quality === optionQuality}
              onClick={() => onQuality(optionQuality)}
            >
              <strong>{optionQuality}</strong>
              <span className={styles.qualityHint}>
                {optionQuality === "720p"
                  ? "smaller"
                  : optionQuality === "1080p"
                    ? "recommended"
                    : "slower"}
              </span>
              <span className={styles.qualitySize}>
                ~
                {formatFileSize(
                  estimatedExportBytes(allDuration, optionQuality),
                )}
              </span>
            </button>
          ))}
        </div>
        <p className={styles.qualityNote}>
          {width} × {height} · about {approximateSize} · export time varies by
          device and render path
        </p>
      </section>
      <section
        className={`${styles.section} ${styles.coverSection}`}
        aria-labelledby="export-cover-label"
      >
        <h3 id="export-cover-label">Cover</h3>
        <div className={styles.coverRow}>
          <span className={styles.coverThumb}>
            {coverImage && <img src={coverImage} alt="Selected cover frame" />}
          </span>
          <span className={styles.coverCopy}>
            <strong>Cover {exportClock(coverAt, false)} · Scene 1</strong>
            <small>
              Saved with the project. Shown on your result card and shared
              links.
            </small>
          </span>
          <button
            type="button"
            className={styles.coverChange}
            onClick={onChooseCover}
          >
            <span className={styles.desktopOnly}>▧ &nbsp;Choose thumbnail</span>
            <span className={styles.phoneOnly}>Change cover ›</span>
          </button>
        </div>
        <p className={styles.coverCaveat}>
          Phones may pick their own thumbnail for downloaded videos.
        </p>
      </section>
      {emptyScenes.length > 0 && (
        <p className={styles.warning}>
          Add a clip to {emptyScenes.join(", ")} to export the scene tree.
        </p>
      )}
    </>
  );
}
