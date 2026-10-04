import type {
  ExportFormat,
  ExportQuality,
} from "../../domain/publishing/model";
import { estimatedExportBytes } from "../../domain/export/quality";
import { formatFileSize } from "../publishing/SharePanel";
import { exportClock } from "./presentation";
import styles from "./ExportSheet.module.css";

type Props = {
  format: ExportFormat;
  quality: ExportQuality;
  mainDuration: number;
  totalDuration: number;
  width: number;
  height: number;
  coverAt: number;
  coverImage: string | null;
  emptyScenes: string[];
  onFormat(format: ExportFormat): void;
  onQuality(quality: ExportQuality): void;
  onChooseCover(): void;
};

export function ExportSettings({
  format,
  quality,
  mainDuration,
  totalDuration,
  width,
  height,
  coverAt,
  coverImage,
  emptyScenes,
  onFormat,
  onQuality,
  onChooseCover,
}: Props) {
  const allDuration = format === "pvo" ? totalDuration : mainDuration;
  const approximateSize = formatFileSize(
    estimatedExportBytes(allDuration, quality),
  );
  return (
    <>
      <section className={styles.section} aria-labelledby="export-format-label">
        <h3 id="export-format-label">Format</h3>
        <div
          className={styles.formatCards}
          role="radiogroup"
          aria-label="Export format"
        >
          <button
            type="button"
            role="radio"
            aria-checked={format === "video"}
            data-selected={format === "video"}
            onClick={() => onFormat("video")}
          >
            <span className={styles.radio}>
              {format === "video" ? "✓" : ""}
            </span>
            <span>
              <strong>Video</strong>
              <small>
                Video file. Main scene only; interactive elements are left out.
              </small>
            </span>
            <em>
              ~{formatFileSize(estimatedExportBytes(mainDuration, quality))}
            </em>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={format === "pvo"}
            data-selected={format === "pvo"}
            onClick={() => onFormat("pvo")}
          >
            <span className={styles.radio}>{format === "pvo" ? "✓" : ""}</span>
            <span>
              <strong>Interactive · .pvo</strong>
              <small>
                Keeps choices, forms and branching. Opens in the Restyle player.
              </small>
            </span>
            <em>
              ~{formatFileSize(estimatedExportBytes(totalDuration, quality))}
            </em>
          </button>
        </div>
        <label className={styles.phoneFormat}>
          Format
          <select
            aria-label="Export format"
            value={format}
            onChange={(event) => onFormat(event.target.value as ExportFormat)}
          >
            <option value="video">Video</option>
            <option value="pvo">.pvo · Interactive</option>
          </select>
        </label>
      </section>
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
