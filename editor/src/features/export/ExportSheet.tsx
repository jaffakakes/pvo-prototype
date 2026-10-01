import { sceneDuration } from "../../domain/scenes/duration";
import { total } from "../../domain/clips/timing";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { Shell } from "../../ui/SheetShell";
import { fmt } from "../../ui/formatTime";
import { SharePanel } from "../publishing/SharePanel";
import styles from "./ExportFeedback.module.css";

import { useExportSession } from "./useExportSession";

export function ExportSheet() {
  const s = useCapture();
  const main = s.scenes.find((scene) => scene.id === "main");
  const length = sceneDuration(main ?? s);
  const components = s.scenes.reduce(
    (count, scene) => count + scene.components.length,
    0,
  );
  const interactive = components > 0 || s.scenes.length > 1;
  const format = interactive ? s.exportFormat : "video";
  const emptyScenes =
    format === "pvo" ? s.scenes.filter((scene) => total(scene.clips) <= 0) : [];
  const { failure, showShare, setShowShare, exported, start } =
    useExportSession(format);
  if (showShare && exported.artifact && exported.url)
    return (
      <SharePanel
        artifact={exported.artifact}
        url={exported.url}
        downloadIssue={failure}
        onDone={() => setShowShare(false)}
      />
    );
  return (
    <Shell
      title="Export"
      sub={`${main?.clips.length ?? 0} clip${main?.clips.length === 1 ? "" : "s"} · ${fmt(length)} · ${s.ratio}${interactive ? ` · ${components} component${components === 1 ? "" : "s"} · ${s.scenes.length} scene${s.scenes.length === 1 ? "" : "s"}` : ""}`}
    >
      {interactive && (
        <>
          <div className={cx("componentSection")}>
            <h3>Format</h3>
            <div className={cx("formatGrid")}>
              <button
                data-on={format === "video"}
                disabled={s.ex === "running"}
                onClick={() => s.patch({ exportFormat: "video", ex: "idle" })}
              >
                <Icon name="export" size={18} />
                <strong>Video</strong>
                <small>Main only · text burned in, components left out</small>
              </button>
              <button
                data-on={format === "pvo"}
                disabled={s.ex === "running"}
                onClick={() => s.patch({ exportFormat: "pvo", ex: "idle" })}
              >
                <Icon name="pvoExport" size={18} />
                <strong>Interactive</strong>
                <small>
                  .pvo · {components} components, {s.scenes.length} scenes, live
                </small>
              </button>
            </div>
          </div>
        </>
      )}
      <div className={cx("qualityGrid")}>
        {(["720p", "1080p"] as const).map((quality) => (
          <button
            key={quality}
            data-on={s.quality === quality}
            onClick={() => s.patch({ quality })}
            disabled={s.ex === "running"}
          >
            <strong>{quality}</strong>
            <span>
              {quality === "720p"
                ? "Faster · smaller file"
                : "Sharper · bigger file"}
            </span>
          </button>
        ))}
      </div>
      {format === "pvo" && (
        <div className={cx("formatInfo")}>
          <Icon name="pvoExport" size={16} />
          Each scene renders as its own video. The included player keeps
          components interactive.
        </div>
      )}
      {emptyScenes.length > 0 && (
        <p className={styles.details}>
          Add a clip to {emptyScenes.map((scene) => scene.name).join(", ")} to
          export the whole scene tree.
        </p>
      )}
      {failure && (
        <details className={styles.details}>
          <summary>Export details</summary>
          <p>{failure}</p>
        </details>
      )}
      {s.ex === "idle" && (
        <button
          className={cx("exportBtn press")}
          disabled={emptyScenes.length > 0}
          onClick={start}
        >
          <Icon name={format === "pvo" ? "pvoExport" : "export"} size={18} />{" "}
          {failure
            ? "Retry export"
            : `Export ${format === "pvo" ? ".pvo" : "video"}`}
        </button>
      )}
      {s.ex === "running" && (
        <div className={cx("exportProgress")}>
          <div>
            <strong>Rendering…</strong>
            <strong>{s.exPct}%</strong>
          </div>
          <span>
            <i style={{ width: `${s.exPct}%` }} />
          </span>
          <p>Plays through once in real time — keep this tab open.</p>
        </div>
      )}
      {s.ex === "done" && (
        <>
          <div className={cx("exportSuccess")}>
            <Icon name="check" size={18} />
            Export ready
          </div>
          <div className={cx("exportDone")}>
            <a
              href={exported.url ?? s.exUrl ?? undefined}
              download={exported.artifact?.filename ?? s.exName}
            >
              Download again
            </a>
            <button
              disabled={!exported.artifact}
              onClick={() => setShowShare(true)}
              data-export-share
            >
              Share
            </button>
          </div>
          <div className={styles.nextActions}>
            <button
              onClick={() => {
                void start();
              }}
            >
              Export again
            </button>
            <button onClick={() => s.reset()}>New video</button>
          </div>
        </>
      )}
    </Shell>
  );
}
