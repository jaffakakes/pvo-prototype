import { useEffect, useRef, useState } from "react";
import { sceneDuration } from "../../domain/scenes/duration";
import { createPublishingClient } from "../../infrastructure/publishing/client";
import { signInWithPopup } from "../../infrastructure/publishing/signIn";
import { closeAuthGate, continueToExport, useAuthGate } from "../../state/auth/authGateStore";
import { useCapture } from "../../state/captureStore";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import styles from "./AuthDialog.module.css";

export function AuthDialog() {
  const source = useAuthGate(state => state.source);
  return source ? <OpenAuthDialog key={source} exporting={source === "export"} /> : null;
}

function OpenAuthDialog({ exporting }: { exporting: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const operation = useRef<AbortController | null>(null);
  const [client] = useState(() => createPublishingClient());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const status = useAuthGate(state => state.status);
  const name = useCapture(state => state.projectName);
  const ratio = useCapture(state => state.ratio);
  const scenes = useCapture(state => state.scenes);
  const main = scenes.find(scene => scene.id === "main");
  const clips = main?.clips ?? [];
  const duration = main ? sceneDuration(main) : 0;

  useEffect(() => {
    const focus = document.activeElement;
    dialog.current?.showModal();
    const controller = new AbortController();
    operation.current = controller;
    void client.status(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      useAuthGate.setState({ status: result });
      if (result.authenticated && exporting) continueToExport();
    }).catch(() => {
      if (!controller.signal.aborted) setError("Couldn't check sign-in. Close this window and try again.");
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => {
      operation.current?.abort();
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, [client, exporting]);

  const signIn = async () => {
    if (!status?.authUrl || busy) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    try {
      await signInWithPopup(status.authUrl, controller.signal);
      const result = await client.status(controller.signal);
      controller.signal.throwIfAborted();
      if (!result.authenticated) throw new Error("Sign-in wasn't completed. Try again.");
      useAuthGate.setState({ status: result });
      if (exporting) continueToExport();
      else closeAuthGate();
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Sign-in failed. Try again.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="auth-title" aria-describedby="auth-description"
    onCancel={event => { event.preventDefault(); closeAuthGate(); }}
    onClick={event => { if (event.target === event.currentTarget) closeAuthGate(); }}>
    <div className={styles.content}>
      <div className={styles.heading}><h2 id="auth-title">{exporting ? "Create a free account to export" : status?.authenticated ? "You're signed in" : "Sign in to Restyle"}</h2>
        <button type="button" className={styles.close} onClick={closeAuthGate} aria-label="Close sign in"><Icon name="close" size={19} /></button>
      </div>
      <p id="auth-description">Your edit stays right here in this browser — sign in and pick up exactly where you left off.</p>
      {exporting && <div className={styles.summary}>
        {clips[0]?.url ? <video src={clips[0].url} muted playsInline preload="metadata" /> : <Icon name="edit" size={28} />}
        <div><strong>{name}</strong><span>{ratio} · {fmt(duration)} · {scenes.length} {scenes.length === 1 ? "scene" : "scenes"}</span></div>
      </div>}
      {busy && <p role="status">Connecting…</p>}
      {status?.available && !status.authenticated && <button type="button" className={styles.provider} disabled={busy || !status.authUrl} onClick={() => { void signIn(); }}><span>G</span>Continue with Google</button>}
      {!busy && status && !status.available && <p className={styles.availability}>Accounts aren't enabled on this beta yet. Your projects stay saved in this browser.{exporting ? " You can still export a file to your device." : " Keep creating — no account is needed to edit."}</p>}
      {!busy && status?.authenticated && <p>{status.user?.name ?? status.user?.email ?? "Your account is ready."}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
    <footer className={styles.footer}>
      <button type="button" onClick={closeAuthGate}>Keep editing</button>
      {exporting && !busy && status && !status.available && <button type="button" className={styles.primary} onClick={continueToExport}>Export to device<Icon name="arrow" size={16} /></button>}
    </footer>
  </dialog>;
}
