import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sceneDuration } from "../../domain/scenes/duration";
import { total } from "../../domain/clips/timing";
import { estimatedExportBytes, exportFrameSize } from "../../domain/export/quality";
import type { ExportSnapshot } from "../../domain/publishing/model";
import { closeAuthGate, requireAccount, useAuthGate } from "../../state/auth/authGateStore";
import { useCapture } from "../../state/captureStore";
import { useExportArtifact } from "../../state/export/exportArtifactStore";
import { downloadCompletedExport } from "./exportWorkflow";
import { SharePanel, formatFileSize } from "../publishing/SharePanel";
import { captureCoverFrame } from "./captureCoverFrame";
import { ExportAccountGate } from "./ExportAccountGate";
import { ExportPreview, exportClock, type ExportView } from "./ExportPreview";
import { useExportSession } from "./useExportSession";
import styles from "./ExportSheet.module.css";

function StageRows({ stage, format, scene, count }: { stage: number; format: "video" | "pvo"; scene: number; count: number }) {
  const rows = [
    ["Preparing media", "Checking clips, audio and fonts"],
    [`Rendering scene ${scene} of ${count}`, "Building video from the original media"],
    ["Packaging file", format === "pvo" ? "Bundling scenes, components and cover into .pvo" : "Muxing video and audio"],
  ];
  return <div className={styles.stages} aria-live="polite">
    {rows.map(([name, detail], index) => <div key={index} className={styles.stage}
      data-status={index < stage ? "done" : index === stage ? "active" : "pending"}>
      <span className={styles.stageIcon} aria-hidden="true">{index < stage ? "✓" : index === stage ? <i /> : ""}</span>
      <span><strong>{name}</strong><small>{detail}</small></span>
    </div>)}
  </div>;
}

export function ExportSheet() {
  const s = useCapture();
  const dialog = useRef<HTMLDialogElement>(null);
  const exportGateOpen = useAuthGate(state => state.source === "export");
  const main = s.scenes.find(scene => scene.id === "main");
  const { failure, failureStage, showShare, setShowShare, exported, start, cancel } = useExportSession(s.exportFormat);
  const [picking, setPicking] = useState(false);
  const [pickerTime, setPickerTime] = useState(s.coverAt);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [resultCoverImage, setResultCoverImage] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const format = s.exportFormat;
  const mode: ExportView = s.ex === "running" ? "exporting" : s.ex === "done" ? "done"
    : exportGateOpen ? "gate" : failure ? "failed" : picking ? "picker" : "setup";
  const mainDuration = main ? sceneDuration(main) : 0;
  const allDuration = format === "pvo" ? s.scenes.reduce((sum, scene) => sum + sceneDuration(scene), 0) : mainDuration;
  const { width, height } = exportFrameSize(s.ratio, s.quality);
  const approximateSize = formatFileSize(estimatedExportBytes(allDuration, s.quality));
  const emptyScenes = format === "pvo" ? s.scenes.filter(scene => total(scene.clips) <= 0) : [];
  const progress = Math.min(100, Math.max(0, s.exPct));
  const stage = exported.renderStage === "preparing" || exported.renderStage === "uploading" ? 0
    : exported.renderStage === "downloading" || progress >= 96 ? 2 : 1;
  const sceneCount = format === "pvo" ? s.scenes.length : 1;
  let sceneNumber = 1;
  if (format === "pvo" && allDuration > 0) {
    let boundary = 0;
    const renderedSeconds = allDuration * progress / 100;
    for (const [index, scene] of s.scenes.entries()) {
      boundary += sceneDuration(scene);
      sceneNumber = index + 1;
      if (renderedSeconds < boundary) break;
    }
  }
  const eta = progress > 4 && elapsed > 0 ? Math.max(0, elapsed * (100 - progress) / progress) : allDuration;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousFocus = document.activeElement;
    element.showModal();
    return () => {
      if (element.open) element.close();
      if (useAuthGate.getState().source === "export") closeAuthGate();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (mode === "gate") document.getElementById("export-dialog-title")?.focus();
  }, [mode]);

  useEffect(() => {
    if (mode !== "exporting") { setStartedAt(null); setElapsed(0); return; }
    const beginning = startedAt ?? Date.now();
    if (startedAt === null) setStartedAt(beginning);
    const timer = window.setInterval(() => setElapsed((Date.now() - beginning) / 1000), 500);
    return () => clearInterval(timer);
  }, [mode, startedAt]);

  useEffect(() => {
    if (!main || mode === "exporting") return;
    const controller = new AbortController();
    let url: string | null = null;
    void captureCoverFrame(main, s.ratio, s.coverAt, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setCoverImage(url);
    }).catch(error => {
      if (!controller.signal.aborted) console.error("Could not preview export cover:", error);
    });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [main, s.ratio, s.coverAt, mode === "exporting"]);

  useEffect(() => {
    const poster = exported.artifact?.poster;
    if (!poster) { setResultCoverImage(null); return; }
    const url = URL.createObjectURL(poster);
    setResultCoverImage(url);
    return () => URL.revokeObjectURL(url);
  }, [exported.artifact?.poster]);

  if (!main) return null;
  const preparePoster = async (snapshot: ExportSnapshot, signal: AbortSignal) => {
    const scene = snapshot.scenes.find(item => item.id === "main");
    return scene ? captureCoverFrame(scene, snapshot.ratio, snapshot.coverAt, signal) : null;
  };
  const begin = () => { void start(preparePoster); };
  const close = () => {
    if (showShare) { setShowShare(false); return; }
    if (exportGateOpen) { closeAuthGate(); s.patch({ sheet: null }); return; }
    if (picking) { setPicking(false); return; }
    s.patch({ sheet: null });
  };
  const saveCover = () => {
    s.edit({ coverAt: Math.max(0, Math.min(Math.max(0, mainDuration - 1 / 30), pickerTime)) });
    setPicking(false);
  };
  const retry720 = () => { s.patch({ quality: "720p" }); begin(); };
  const download = async () => {
    if (!await requireAccount("download")) return;
    const current = useExportArtifact.getState();
    if (current.url && current.artifact)
      downloadCompletedExport(current.url, current.artifact.filename);
  };
  const share = async () => {
    if (await requireAccount("share")) setShowShare(true);
  };
  return createPortal(<dialog ref={dialog} className={styles.dialog} data-state={mode}
    data-ratio={s.ratio} onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}
    aria-labelledby="export-dialog-title" aria-describedby={mode === "gate" ? "export-gate-description" : undefined}>
    <div className={styles.layout}>
      <ExportPreview scene={main} ratio={s.ratio} mode={mode} pickerTime={pickerTime}
        onPickerTime={setPickerTime} artifact={exported.artifact} artifactUrl={exported.url} />
      <div className={styles.right}>
        <header className={styles.header}>
          <div>
            {mode === "done" && <span className={`${styles.readyBadge} ${styles.desktopReadyBadge}`}>✓ &nbsp;READY</span>}
            <h2 id="export-dialog-title" tabIndex={-1}>{mode === "gate" ? "Create a free account to export"
              : mode === "picker" ? "Choose cover" : mode === "exporting" ? "Exporting…"
              : mode === "done" ? <><span className={styles.desktopOnly}>Your {format === "pvo" ? "export" : "video"} is ready</span><span className={styles.phoneOnly}>Ready</span></>
                : mode === "failed" ? "Export failed" : "Export"}</h2>
            <p>{mode === "gate" ? "Your chosen export is ready to start after sign-in."
              : mode === "done" ? "Playing the exported file"
              : `${s.projectName || "Untitled video"} · ${s.scenes.length} scene${s.scenes.length === 1 ? "" : "s"} · ${exportClock(allDuration)} · ${s.ratio}`}</p>
          </div>
          <button type="button" className={styles.close} aria-label={picking ? "Close cover picker" : "Close export"} onClick={close}>×</button>
        </header>

        <div className={styles.body} data-export-settings>
          {mode === "gate" && <ExportAccountGate projectName={s.projectName} format={format}
            quality={s.quality} duration={allDuration} sceneCount={s.scenes.length} coverImage={coverImage} />}
          {mode === "setup" && <>
            <section className={styles.section} aria-labelledby="export-format-label">
              <h3 id="export-format-label">Format</h3>
              <div className={styles.formatCards} role="radiogroup" aria-label="Export format">
                <button type="button" role="radio" aria-checked={format === "video"} data-selected={format === "video"}
                  onClick={() => s.patch({ exportFormat: "video" })}>
                  <span className={styles.radio}>{format === "video" ? "✓" : ""}</span>
                  <span><strong>Video</strong><small>Video file. Main scene only; interactive elements are left out.</small></span>
                  <em>~{formatFileSize(estimatedExportBytes(mainDuration, s.quality))}</em>
                </button>
                <button type="button" role="radio" aria-checked={format === "pvo"} data-selected={format === "pvo"}
                  onClick={() => s.patch({ exportFormat: "pvo" })}>
                  <span className={styles.radio}>{format === "pvo" ? "✓" : ""}</span>
                  <span><strong>Interactive · .pvo</strong><small>Keeps choices, forms and branching. Opens in the Restyle player.</small></span>
                  <em>~{formatFileSize(estimatedExportBytes(s.scenes.reduce((sum, scene) => sum + sceneDuration(scene), 0), s.quality))}</em>
                </button>
              </div>
              <label className={styles.phoneFormat}>Format
                <select aria-label="Export format" value={format} onChange={event => s.patch({ exportFormat: event.target.value as "video" | "pvo" })}>
                  <option value="video">Video</option><option value="pvo">.pvo · Interactive</option>
                </select>
              </label>
            </section>
            <section className={styles.section} aria-labelledby="export-quality-label">
              <h3 id="export-quality-label">Quality</h3>
              <div className={styles.quality} role="radiogroup" aria-label="Export quality">
                {(["720p", "1080p", "4K"] as const).map(quality =>
                  <button key={quality} type="button" role="radio" aria-checked={s.quality === quality}
                    data-selected={s.quality === quality} onClick={() => s.patch({ quality })}>
                    <strong>{quality}</strong><span className={styles.qualityHint}>{quality === "720p" ? "smaller" : quality === "1080p" ? "recommended" : "slower"}</span>
                    <span className={styles.qualitySize}>~{formatFileSize(estimatedExportBytes(allDuration, quality))}</span>
                  </button>)}
              </div>
              <p className={styles.qualityNote}>{width} × {height} · about {approximateSize} · export time varies by device and render path</p>
            </section>
            <section className={`${styles.section} ${styles.coverSection}`} aria-labelledby="export-cover-label">
              <h3 id="export-cover-label">Cover</h3>
              <div className={styles.coverRow}>
                <span className={styles.coverThumb}>{coverImage && <img src={coverImage} alt="Selected cover frame" />}</span>
                <span className={styles.coverCopy}><strong>Cover {exportClock(s.coverAt, false)} · Scene 1</strong><small>Saved with the project. Shown on your result card and shared links.</small></span>
                <button type="button" className={styles.coverChange} onClick={() => { setPickerTime(s.coverAt); setPicking(true); }}>
                  <span className={styles.desktopOnly}>▧ &nbsp;Choose thumbnail</span><span className={styles.phoneOnly}>Change cover ›</span>
                </button>
              </div>
              <p className={styles.coverCaveat}>Phones may pick their own thumbnail for downloaded videos.</p>
            </section>
            {emptyScenes.length > 0 && <p className={styles.warning}>Add a clip to {emptyScenes.map(scene => scene.name).join(", ")} to export the scene tree.</p>}
          </>}

          {mode === "picker" && <div className={styles.pickerDetail}>
            <strong className={styles.pickerTime}>{exportClock(pickerTime)}</strong>
            <span>Scene 1 · frame {Math.round(pickerTime * 30)}</span>
            <p>Scrub the preview to the frame you want. The cover keeps the video's text; editor guides and handles are left out.</p>
            <hr />
            <p>The cover appears on your result card and shared links. Phones may pick their own thumbnail for downloaded videos.</p>
          </div>}

          {mode === "exporting" && <>
            <div className={styles.progressHeading}><strong>{progress}%</strong><span>about {exportClock(eta, false)} left</span></div>
            <div className={styles.progressTrack} role="progressbar" aria-label="Export progress"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <i style={{ width: `${progress}%` }} /><b style={{ left: "15%" }} /><b style={{ left: "90%" }} />
            </div>
            <span className={styles.progressAnnouncement} aria-live="polite">{Math.floor(progress / 10) * 10}% · {stage === 0 ? "Preparing media" : stage === 1 ? `Rendering scene ${sceneNumber} of ${sceneCount}` : "Packaging file"}</span>
            <StageRows stage={stage} format={format} scene={sceneNumber} count={sceneCount} />
            <p className={styles.keepOpen}><b>!</b><span><strong>Keep this tab open.</strong>
              <span className={styles.desktopOnly}> Your export continues if you pause the preview.</span>
              <span className={styles.phoneOnly}> · about {exportClock(eta, false)} left</span>
            </span></p>
            <div className={styles.locked}>♙ {format === "pvo" ? ".pvo" : "Video"} · {s.quality} · Cover {exportClock(s.coverAt, false)}</div>
          </>}

          {mode === "done" && exported.artifact && <>
            <span className={`${styles.readyBadge} ${styles.phoneReadyBadge}`}>✓ &nbsp;READY</span>
            <div className={styles.fileCard}>
              <span className={styles.fileCover}>{resultCoverImage && <img src={resultCoverImage} alt="Export cover" />}</span>
              <span><strong>{exported.artifact.filename}</strong><small>{format === "pvo" ? "PVO · Interactive" : "Video"} · {width} × {height}</small>
                <small>{exportClock(allDuration, false)} · {formatFileSize(exported.artifact.blob.size)} · Cover {exportClock(exported.artifact.coverAt, false)}</small></span>
            </div>
            <div className={`${styles.doneActions} ${styles.desktopReadyActions}`}>
              <button type="button" className={styles.primary} onClick={() => { void download(); }}>↓ &nbsp;Download</button>
              <button type="button" className={styles.shareAction} data-export-share onClick={() => { void share(); }}>Share</button>
            </div>
            <p className={styles.readyNote}>Share opens alongside — this result stays put. The cover is saved with your project and frozen for this export.</p>
            <button type="button" className={`${styles.linkAction} ${styles.desktopReadyActions}`}
              onClick={() => s.patch({ ex: "idle", exPct: 0 })}>Export again with different settings</button>
          </>}

          {mode === "failed" && <div className={styles.failed}>
            <strong>Stopped at {failureStage === "preparing" ? "Preparing media" : failureStage === "downloading" ? "Packaging file" : `Rendering scene ${sceneNumber} of ${sceneCount}`} · {progress}%</strong>
            <p>We couldn't finish this export. Your settings and cover are kept.</p>
            <pre>{failure}</pre>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(failure ?? "Export failed"); }}>Copy details</button>
            <div className={styles.locked}>♙ {format === "pvo" ? ".pvo" : "Video"} · {s.quality} · Cover {exportClock(s.coverAt, false)}</div>
          </div>}
        </div>

        <footer className={styles.footer}>
          {mode === "gate" && <><p>Sign in or create an account with Google or email.</p>
            <button type="button" className={styles.quietAction} onClick={close}>Keep editing</button></>}
          {mode === "setup" && <><p>{format === "pvo" ? "Opens in the Restyle player; shared links show the cover."
            : "Interactive elements are left out of video exports."}</p>
            <button type="button" className={styles.primary} disabled={emptyScenes.length > 0 || mainDuration <= 0}
              onClick={begin}>↑ &nbsp;Export {format === "pvo" ? ".pvo" : "video"} · {s.quality}</button></>}
          {mode === "picker" && <><p>Frozen for this export; you can change it later.</p>
            <button type="button" className={styles.primary} onClick={saveCover}>✓ &nbsp;Use this frame</button></>}
          {mode === "exporting" && <><p>Progress continues if you pause the preview.</p>
            <button type="button" className={styles.quietAction} onClick={cancel}>Cancel export</button></>}
          {mode === "done" && <div className={styles.doneActions}>
            <button type="button" className={styles.primary} onClick={() => { void download(); }}>↓ &nbsp;Download</button>
            <button type="button" className={styles.shareAction} data-export-share onClick={() => { void share(); }}>Share</button>
            <button type="button" className={styles.linkAction} onClick={() => s.patch({ ex: "idle", exPct: 0 })}>Export again with different settings</button>
          </div>}
          {mode === "failed" && <div className={styles.failedActions}>
            <button type="button" className={styles.primary} onClick={begin}>Retry</button>
            <button type="button" className={styles.quietAction} onClick={retry720}>Retry at 720p</button>
            <button type="button" className={styles.linkAction} onClick={() => { setPicking(false); useCapture.getState().patch({ ex: "idle", exPct: 0 }); }}>Back to settings</button>
          </div>}
        </footer>
      </div>
    </div>
    {showShare && exported.artifact && exported.url && <div className={styles.shareOverlay}>
      <div className={styles.shareCard} role="dialog" aria-label="Share export">
        <SharePanel embedded artifact={exported.artifact} url={exported.url} renderMethod={exported.renderMethod}
          onDone={() => setShowShare(false)} />
      </div>
    </div>}
  </dialog>, document.body);
}
