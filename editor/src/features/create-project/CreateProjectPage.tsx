import { useRef, useState, useSyncExternalStore } from "react";
import {
  discardProjectRecovery,
  getProjectStorageStatus,
  retryProjectStorage,
  subscribeProjectStorage,
} from "../../app/projectAutosave";
import { nameFromFile } from "../../domain/project/creation";
import type { Ratio } from "../../domain/project/model";
import { PROJECT_TEMPLATES, type ProjectTemplate } from "../../domain/project/templates";
import { useCapture } from "../../state/captureStore";
import { Icon } from "../../ui/Icon";
import { MediaInput } from "./MediaInput";
import { DropReadyPanel } from "./DropReadyPanel";
import { ProjectRecoveryNotice } from "./ProjectRecoveryNotice";
import { RatioPicker } from "./RatioPicker";
import { TemplateGallery } from "./TemplateGallery";
import { createProject, resumeProject } from "./projectCommands";
import { usePageDrop } from "./usePageDrop";
import { useProjectMedia, type PreparedMedia } from "./useProjectMedia";
import styles from "./CreateProject.module.css";

type Props = { hero?: "studio" | "drop"; templateId?: string | null; active?: boolean; onSignIn(): void };

export function CreateProjectPage({ hero = "studio", templateId, active = true, onSignIn }: Props) {
  const template = PROJECT_TEMPLATES.find(item => item.id === templateId);
  const [enteredName, setName] = useState<string | null>(template?.title ?? null);
  const [ratio, setRatio] = useState<Ratio>(template?.ratio ?? "9:16");
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const staged = useProjectMedia();
  const name = enteredName ?? (staged.media[0] ? nameFromFile(staged.media[0].file.name) : "");
  const busy = starting || staged.progress !== null;
  const savedName = useCapture(state => state.projectName);
  const hasProject = useCapture(state => !!state.localId);
  const storage = useSyncExternalStore(subscribeProjectStorage, getProjectStorageStatus);
  const unavailable = storage.phase !== "ready";
  const recovering = storage.phase === "restore-failed" || storage.phase === "retrying";
  const pick = () => input.current?.click();

  const addFiles = async (files: File[]) => {
    await staged.addFiles(files);
  };
  const dragging = usePageDrop(files => { void addFiles(files); }, busy, active);

  const start = async (media: PreparedMedia[], title: string, selected?: ProjectTemplate) => {
    if (starting || unavailable) return;
    setStarting(true);
    setFailure(null);
    try {
      await createProject({ name: title, ratio, clips: media.map(item => item.clip), template: selected }, () => staged.transfer(media));
    } catch (error) {
      console.error("Could not create the local project:", error);
      setFailure("Couldn't save the previous project. Retry browser storage before starting a new edit.");
      setStarting(false);
    }
  };
  const sample = async () => {
    await staged.loadSample();
  };
  const useTemplate = async (selected: ProjectTemplate) => {
    const ready = await staged.loadSample();
    if (ready.length) await start(ready, selected.title, selected);
  };
  const entryButtons = <div className={styles.entryButtons}>
    <button type="button" disabled={busy || unavailable} onClick={() => { void start([], name); }}><Icon name="card" size={15} />Blank project</button>
    <button type="button" disabled={busy} onClick={() => { void sample(); }}><span aria-hidden="true">✦</span>Try a sample clip</button>
  </div>;
  const dropHero = hero === "drop" && !staged.media.length;

  return <div className={styles.page} data-dragging={dragging} data-variant={hero}>
    <header className={styles.header}>
      <a className={styles.brand} href="?home=1" aria-label="Restyle home"><span><img src="./restyle-mark.png" alt="" /></span><strong>restyle</strong></a>
      <span className={styles.webTag}>WEB</span>
      <div className={styles.headerActions}><span className={styles.guestStatus}><i />No account needed · sign up only to export</span>
        <button type="button" className={styles.signIn} onClick={onSignIn}>Sign in</button>
      </div>
    </header>
    <main className={styles.main}>
      {hasProject && <div className={styles.resume}>
        <span className={styles.resumeIcon}><Icon name="edit" size={22} /></span>
        <div><strong>{savedName}</strong><span>Saved in this browser</span></div>
        <button type="button" disabled={busy} onClick={resumeProject}>Resume <Icon name="arrow" size={16} /></button>
      </div>}
      <input ref={input} className={styles.fileInput} type="file" accept="video/*,.mp4,.mov,.hevc" multiple tabIndex={-1} aria-label="Upload video files"
        onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addFiles(files); }} />
      {dropHero ? <section className={styles.dropHero} aria-labelledby="create-title">
        <button className={styles.heroTarget} type="button" onClick={pick} disabled={busy} aria-label="Choose video files" />
        <img className={styles.heroMark} src="./restyle-mark.png" alt="" />
        <span className={styles.freeBadge}>✦ Free · no sign-up</span>
        <span className={styles.heroFormats}>MP4 · MOV · HEVC · up to 2 GB</span>
        <span className={styles.uploadIcon}><Icon name="export" size={38} /></span>
        <h1 id="create-title">Drop clips to start editing</h1>
        <p>Anywhere on this page. No account until you export.</p>
        <div className={styles.heroActions}><button type="button" className={styles.primary} disabled={busy} onClick={pick}><Icon name="export" size={18} />Upload files</button>{entryButtons}</div>
        {busy && <p role="status">Preparing your clips…</p>}
      </section> : hero === "drop" ? <DropReadyPanel media={staged.media} progress={staged.progress}
        name={name} ratio={ratio} busy={busy} starting={starting} unavailable={unavailable}
        onNameChange={setName} onRatioChange={setRatio} onPick={pick} onRemove={staged.remove}
        onStart={() => { void start(staged.media, name, template); }} /> : <section className={styles.studio} aria-labelledby="create-title" data-variant={hero}>
        <div className={styles.studioHead}>
          <div><h1 id="create-title">Start a new edit</h1><p>Drop your clips, name it, pick a ratio. You're in the editor in one click.</p></div>
          <span className={styles.freeBadge}>✦ Free · no sign-up</span>
        </div>
        <form className={styles.form} onSubmit={event => { event.preventDefault(); if (staged.media.length && !busy) void start(staged.media, name, template); }}>
          <div className={styles.mediaColumn}>
            <MediaInput media={staged.media} progress={staged.progress} disabled={busy} onPick={pick} onRemove={staged.remove} />
            {entryButtons}
          </div>
          <div className={styles.settings}>
            <label className={styles.name}>Project name<input value={name} maxLength={120} placeholder="Untitled edit" disabled={starting}
              onFocus={event => setName(event.currentTarget.value)} onChange={event => setName(event.target.value)} /></label>
            <RatioPicker value={ratio} onChange={setRatio} disabled={starting} />
            <div className={styles.start}>
              <button type="submit" className={styles.primary} disabled={!staged.media.length || busy || unavailable}>{starting ? "Opening your edit…" : "Start editing"}<Icon name="arrow" size={18} /></button>
              <p>Saved in this browser. You only sign up when you export.</p>
            </div>
          </div>
        </form>
      </section>}
      {(staged.error || failure) && <p className={styles.error} role="alert">{staged.error || failure}</p>}
      {recovering && <ProjectRecoveryNotice
        blocked={storage.recoveryBlocked}
        busy={storage.phase === "retrying"}
        onRetry={retryProjectStorage}
        onDiscard={discardProjectRecovery}
      />}
      {!staged.error && !failure && storage.phase === "starting"
        && <p className={styles.storagePending} role="status">Checking saved edits…</p>}
      <TemplateGallery disabled={busy || unavailable} onSelect={selected => { void useTemplate(selected); }} />
    </main>
    {dragging && <div className={styles.dropOverlay}><Icon name="export" size={40} /><strong>Drop your clips anywhere</strong><span>Let's start your next edit.</span></div>}
  </div>;
}
