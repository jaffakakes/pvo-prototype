import { useEffect, useRef, useState } from "react";
import type { CompletedExport } from "../../domain/publishing/model";
import { cancelledShare, copyPublicationLink } from "../../infrastructure/publishing/nativeShare";
import { downloadCompletedExport } from "../export/exportWorkflow";
import { requireAccount } from "../../state/auth/authGateStore";
import { Icon } from "../../ui/Icon";
import { Shell } from "../../ui/SheetShell";
import { usePublication } from "./usePublication";
import { SharedVideos } from "./SharedVideos";
import styles from "./SharePanel.module.css";

export function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SharePanel({ artifact, url, renderMethod, downloadIssue, embedded = false, autoCreate = false, onBusyChange, onDone }: { artifact: CompletedExport; url: string;
  renderMethod?: "server" | "browser" | "mixed" | null; downloadIssue?: string | null; embedded?: boolean; autoCreate?: boolean; onBusyChange?(busy: boolean): void; onDone(): void }) {
  const publish = usePublication(artifact);
  const [title, setTitle] = useState(publish.title ?? artifact.filename.replace(/\.pvo$/i, ""));
  const [localFailure, setLocalFailure] = useState<string | null>(downloadIssue ?? null);
  const [copied, setCopied] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const mounted = useRef(true);
  const autoStarted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const ready = publish.publication?.status === "ready" ? publish.publication : null;
  const busy = publish.stage !== "idle";
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const tooLarge = !!publish.status?.available && artifact.blob.size > publish.status.maxBytes;
  const failure = localFailure ?? publish.failure;
  useEffect(() => {
    if (!autoCreate || autoStarted.current || !publish.status?.available || !publish.status.hasSession
      || publish.stage !== "idle" || publish.publication || failure) return;
    autoStarted.current = true;
    void publish.createLink(title);
  }, [autoCreate, publish.status, publish.stage, publish.publication, failure, title]);
  const renderLabel = renderMethod === "server" ? "rendered on server"
    : renderMethod === "browser" ? "rendered in browser"
    : renderMethod === "mixed" ? "server and browser scenes" : null;
  const clearFailure = () => { setLocalFailure(null); publish.clearFailure(); };
  const downloadAgain = async () => {
    if (!await requireAccount("download")) return;
    downloadCompletedExport(url, artifact.filename);
  };
  const shareLink = async () => {
    if (!ready) return;
    clearFailure();
    try { await navigator.share({ title: publish.title ?? title, url: ready.url }); }
    catch (error) { if (mounted.current && !cancelledShare(error)) setLocalFailure("Couldn't share the link. Try copying it."); }
  };
  const panel = <div className={styles.panel} data-share-panel>
      <div className={styles.file}>
        <span className={styles.fileIcon}><Icon name={artifact.format === "pvo" ? "pvoExport" : "export"} size={24} /></span>
        <div><strong>{artifact.filename}</strong><p>{artifact.format === "pvo" ? "Interactive PVO" : "Video"} · {formatFileSize(artifact.blob.size)}
          {renderLabel && ` · ${renderLabel}`}</p></div>
        <Icon name="check" size={19} />
      </div>
      <div className={styles.fileActions}>
        <button type="button" onClick={() => { void downloadAgain(); }} data-download-again>Download PVO file</button>
      </div>
      <section className={styles.online} aria-label="Create an online link">
        <h3>{ready ? "Your link is ready" : "Creating your link"}</h3>
        <p>Anyone with the link can watch and forward it.</p>
        {publish.stage === "checking" && <p role="status">Checking link sharing…</p>}
        {publish.status?.available === false && <p className={styles.unavailable}>Link sharing isn’t available yet.</p>}
        {!publish.status && publish.stage === "idle" && <button type="button" onClick={() => { clearFailure(); void publish.refreshStatus(); }}>Try again</button>}
        {ready ? <>
          <input className={styles.link} value={ready.url} readOnly aria-label="Published PVO link" onFocus={event => event.currentTarget.select()} />
          <div className={styles.linkActions}>
            <button type="button" onClick={() => {
              clearFailure();
              void copyPublicationLink(ready.url).then(() => { if (mounted.current) setCopied(true); })
                .catch(() => { if (mounted.current) setLocalFailure("Couldn't copy the link. Select it to copy."); });
            }} data-copy-publication>{copied ? "Copied" : "Copy link"}</button>
            {typeof navigator.share === "function" && <button type="button" onClick={() => { void shareLink(); }}>Share link</button>}
            <a href={ready.url} target="_blank" rel="noopener noreferrer">Open PVO</a>
          </div>
        </> : <>
          {publish.status?.available && <>
            <label className={styles.title}>PVO title<input value={publish.title ?? title} maxLength={120}
              disabled={busy || publish.title !== null} onChange={event => setTitle(event.target.value)} /></label>
            {tooLarge && <p className={styles.unavailable}>This PVO exceeds the storage service's maximum file size.</p>}
            <small className={styles.limit}>Large PVOs upload in parts. Your local file stays available if sharing fails.</small>
            <small className={styles.limit}>Your account can manage and delete this link on your devices.</small>
          </>}
          <button type="button" className={styles.primary} data-create-publication
            disabled={!publish.status?.available || busy || tooLarge || !(publish.title ?? title).trim()}
            onClick={() => { clearFailure(); void publish.createLink(title); }}>
            {publish.stage === "uploading" ? "Uploading…" : publish.stage === "preparing" || publish.stage === "reserving" ? "Preparing link…" : failure ? "Retry sharing" : "Create link"}
          </button>
          {busy && publish.stage !== "checking" && <div className={styles.progress} role="status">
            <progress aria-label={publish.stage === "uploading" ? "Uploading exported file" : "Preparing online sharing"}
              value={publish.stage === "uploading" ? publish.uploadedBytes : undefined}
              max={publish.stage === "uploading" ? artifact.blob.size : undefined} />
            {publish.stage === "uploading" && <span>{Math.round(publish.uploadedBytes / artifact.blob.size * 100)}% uploaded</span>}
            <button type="button" onClick={publish.cancel}>Cancel</button>
          </div>}
        </>}
      </section>
      {failure && <p className={styles.error} role="alert">{failure}</p>}
      {publish.status?.hasSession && <details className={styles.manage} onToggle={event => setShowLibrary(event.currentTarget.open)}>
        <summary>Shared PVOs</summary>
        {showLibrary && <SharedVideos client={publish.client} />}
      </details>}
      <button type="button" className={styles.done} onClick={onDone} disabled={busy} data-share-done>Done</button>
    </div>;
  return embedded ? panel : <Shell title="Share" sub="Your PVO is being shared as a link.">{panel}</Shell>;
}
