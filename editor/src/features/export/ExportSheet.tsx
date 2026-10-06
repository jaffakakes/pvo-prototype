import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sceneDuration } from "../../domain/scenes/duration";
import { total } from "../../domain/clips/timing";
import { exportFrameSize } from "../../domain/export/quality";
import type { ExportSnapshot } from "../../domain/publishing/model";
import {
  closeAuthGate,
  requireAccount,
  useAuthGate,
} from "../../state/auth/authGateStore";
import { useCapture } from "../../state/captureStore";
import {
  useExportArtifact,
  discardPreparedExport,
} from "../../state/export/exportArtifactStore";
import { useExportDownload } from "./useExportDownload";
import { SharePanel } from "../publishing/SharePanel";
import { captureCoverFrame } from "./captureCoverFrame";
import { ExportAccountGate } from "./ExportAccountGate";
import { ExportFooter } from "./ExportFooter";
import { ExportResult } from "./ExportResult";
import { ExportSettings } from "./ExportSettings";
import { ExportProgress } from "./ExportProgress";
import { ExportPreview } from "./ExportPreview";
import { exportClock, exportView } from "./presentation";
import { useExportProgress } from "./useExportProgress";
import { useCoverPreview, usePosterPreview } from "./useExportPreviewUrls";
import { exportCoverAt } from "../../domain/project/cover";
import { useExportSession } from "./useExportSession";
import styles from "./ExportSheet.module.css";

export function ExportSheet() {
  const s = useCapture();
  const dialog = useRef<HTMLDialogElement>(null);
  const exportGateOpen = useAuthGate((state) => state.source === "export");
  const main = s.scenes.find((scene) => scene.id === "main");
  const {
    failure,
    failureStage,
    showShare,
    setShowShare,
    exported,
    start,
    cancel,
  } = useExportSession("pvo");
  const exportDownload = useExportDownload();
  const [picking, setPicking] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [pickerTime, setPickerTime] = useState(s.coverAt);
  const format = "pvo" as const;
  const mode = exportView(s.ex, exportGateOpen, failure, picking);
  const coverImage = useCoverPreview(
    main,
    s.ratio,
    s.coverAt,
    mode !== "exporting",
  );
  const resultCoverImage = usePosterPreview(exported.artifact?.poster);
  const mainDuration = main ? sceneDuration(main) : 0;
  const {
    progress,
    stage,
    sceneCount,
    sceneNumber,
    eta,
    duration: allDuration,
  } = useExportProgress(
    mode === "exporting",
    s.scenes,
    format,
    s.exPct,
    exported.renderStage,
  );
  const { width, height } = exportFrameSize(s.ratio, s.quality);
  const emptyScenes =
    format === "pvo" ? s.scenes.filter((scene) => total(scene.clips) <= 0) : [];

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousFocus = document.activeElement;
    element.showModal();
    return () => {
      if (element.open) element.close();
      if (useAuthGate.getState().source === "export") closeAuthGate();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (mode === "gate")
      document.getElementById("export-dialog-title")?.focus();
  }, [mode]);

  if (!main) return null;
  const preparePoster = async (
    snapshot: ExportSnapshot,
    signal: AbortSignal,
  ) => {
    const scene = snapshot.scenes.find((item) => item.id === "main");
    return scene
      ? captureCoverFrame(scene, snapshot.ratio, snapshot.coverAt, signal)
      : null;
  };
  const begin = () => {
    void start(preparePoster);
  };
  const close = () => {
    if (showShare) {
      if (shareBusy) return;
      setShowShare(false);
      return;
    }
    if (exportGateOpen) {
      closeAuthGate();
      s.patch({ sheet: null });
      return;
    }
    if (picking) {
      setPicking(false);
      return;
    }
    s.patch({ sheet: null });
  };
  const saveCover = () => {
    s.edit({
      coverAt: exportCoverAt({ scenes: s.scenes, coverAt: pickerTime }),
    });
    setPicking(false);
  };
  const retry720 = () => {
    discardPreparedExport();
    s.patch({ quality: "720p" });
    begin();
  };
  const download = async () => {
    const current = useExportArtifact.getState();
    if (current.url && current.artifact)
      await exportDownload.download(current.artifact, current.url);
  };
  const backToSettings = () => {
    discardPreparedExport();
    setPicking(false);
    s.patch({ ex: "idle", exPct: 0 });
  };
  const share = async () => {
    if (await requireAccount("share")) setShowShare(true);
  };
  return createPortal(
    <dialog
      ref={dialog}
      className={styles.dialog}
      data-state={mode}
      data-ratio={s.ratio}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      aria-labelledby="export-dialog-title"
      aria-describedby={mode === "gate" ? "export-gate-description" : undefined}
    >
      <div className={styles.layout}>
        <ExportPreview
          scene={main}
          ratio={s.ratio}
          mode={mode}
          pickerTime={pickerTime}
          onPickerTime={setPickerTime}
          artifact={exported.artifact}
          artifactUrl={exported.url}
        />
        <div className={styles.right}>
          <header className={styles.header}>
            <div>
              {mode === "done" && (
                <span
                  className={`${styles.readyBadge} ${styles.desktopReadyBadge}`}
                >
                  ✓ &nbsp;READY
                </span>
              )}
              <h2 id="export-dialog-title" tabIndex={-1}>
                {mode === "gate" ? (
                  "Create a free account to export"
                ) : mode === "picker" ? (
                  "Choose cover"
                ) : mode === "exporting" ? (
                  "Exporting…"
                ) : mode === "done" ? (
                  <>
                    <span className={styles.desktopOnly}>
                      Your export is ready
                    </span>
                    <span className={styles.phoneOnly}>Ready</span>
                  </>
                ) : mode === "failed" ? (
                  "Export failed"
                ) : (
                  "Export"
                )}
              </h2>
              <p>
                {mode === "gate"
                  ? "Your chosen export is ready to start after sign-in."
                  : mode === "done"
                    ? "Playing the exported file"
                    : `${s.projectName || "Untitled video"} · ${s.scenes.length} scene${s.scenes.length === 1 ? "" : "s"} · ${exportClock(allDuration)} · ${s.ratio}`}
              </p>
            </div>
            <button
              type="button"
              className={styles.close}
              aria-label={picking ? "Close cover picker" : "Close export"}
              onClick={close}
            >
              ×
            </button>
          </header>

          <div className={styles.body} data-export-settings>
            {mode === "gate" && (
              <ExportAccountGate
                projectName={s.projectName}
                format={format}
                quality={s.quality}
                duration={allDuration}
                sceneCount={s.scenes.length}
                coverImage={coverImage}
              />
            )}
            {mode === "setup" && (
              <ExportSettings
                quality={s.quality}
                totalDuration={s.scenes.reduce(
                  (sum, scene) => sum + sceneDuration(scene),
                  0,
                )}
                width={width}
                height={height}
                coverAt={s.coverAt}
                coverImage={coverImage}
                emptyScenes={emptyScenes.map((scene) => scene.name)}
                onQuality={(quality) => s.patch({ quality })}
                onChooseCover={() => {
                  setPickerTime(s.coverAt);
                  setPicking(true);
                }}
              />
            )}

            {mode === "picker" && (
              <div className={styles.pickerDetail}>
                <strong className={styles.pickerTime}>
                  {exportClock(pickerTime)}
                </strong>
                <span>Scene 1 · frame {Math.round(pickerTime * 30)}</span>
                <p>
                  Scrub the preview to the frame you want. The cover keeps the
                  video's text; editor guides and handles are left out.
                </p>
                <hr />
                <p>
                  The cover appears on your result card and shared links. Phones
                  can see it on your shared PVO link.
                </p>
              </div>
            )}

            {mode === "exporting" && (
              <ExportProgress
                progress={progress}
                stage={stage}
                sceneNumber={sceneNumber}
                sceneCount={sceneCount}
                eta={eta}
                duration={allDuration}
                format={format}
                quality={s.quality}
                coverAt={s.coverAt}
              />
            )}

            {mode === "done" && exported.artifact && (
              <ExportResult
                artifact={exported.artifact}
                format={format}
                coverImage={resultCoverImage}
                width={width}
                height={height}
                duration={allDuration}
                onDownload={download}
                onShare={share}
                onAgain={backToSettings}
              />
            )}

            {mode === "done" && exportDownload.busy && (
              <p role="status">Checking connected services…</p>
            )}
            {mode === "done" && exportDownload.failure && (
              <p role="alert">{exportDownload.failure}</p>
            )}
            {mode === "failed" && (
              <div className={styles.failed}>
                <strong>
                  Stopped at{" "}
                  {failureStage === "activating"
                    ? "Connecting services"
                    : failureStage === "preparing"
                      ? "Preparing media"
                      : failureStage === "downloading"
                        ? "Packaging file"
                        : `Rendering scene ${sceneNumber} of ${sceneCount}`}{" "}
                  · {progress}%
                </strong>
                <p>
                  {exported.prepared
                    ? "Your prepared file is kept. Retry checks the same service and file without rendering again."
                    : "We couldn’t finish this export. Your settings and cover are kept."}
                </p>
                <pre>{failure}</pre>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      failure ?? "Export failed",
                    );
                  }}
                >
                  Copy details
                </button>
                <div className={styles.locked}>
                  ♙ .pvo · {s.quality} · Cover {exportClock(s.coverAt, false)}
                </div>
              </div>
            )}
          </div>

          <ExportFooter
            mode={mode}
            format={format}
            quality={s.quality}
            unavailable={emptyScenes.length > 0 || mainDuration <= 0}
            close={close}
            begin={begin}
            saveCover={saveCover}
            cancel={cancel}
            download={download}
            share={share}
            retry720={retry720}
            backToSettings={backToSettings}
          />
        </div>
      </div>
      {showShare && exported.artifact && exported.url && (
        <div className={styles.shareOverlay}>
          <div
            className={styles.shareCard}
            role="dialog"
            aria-label="Share export"
          >
            <SharePanel
              embedded
              autoCreate
              onBusyChange={setShareBusy}
              artifact={exported.artifact}
              url={exported.url}
              renderMethod={exported.renderMethod}
              onDone={() => setShowShare(false)}
            />
          </div>
        </div>
      )}
    </dialog>,
    document.body,
  );
}
