import { useEffect, useRef } from "react";
import { closeAuthGate, useAuthGate } from "../../state/auth/authGateStore";
import { Icon } from "../../ui/Icon";
import styles from "./AuthDialog.module.css";

export function AuthDialog() {
  const source = useAuthGate(state => state.source);
  return source ? <OpenAuthDialog /> : null;
}

function OpenAuthDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const focus = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, []);

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="auth-title" aria-describedby="auth-description"
    onCancel={event => { event.preventDefault(); closeAuthGate(); }}
    onClick={event => { if (event.target === event.currentTarget) closeAuthGate(); }}>
    <div className={styles.content}>
      <div className={styles.heading}><h2 id="auth-title">Sign in to Restyle</h2>
        <button type="button" className={styles.close} onClick={closeAuthGate} aria-label="Close sign in"><Icon name="close" size={19} /></button>
      </div>
      <p id="auth-description">Accounts aren't enabled on this beta yet. Your projects stay saved in this browser.</p>
      <p className={styles.availability}>You can edit, export and create links without signing in.</p>
    </div>
    <footer className={styles.footer}>
      <button type="button" onClick={closeAuthGate}>Keep editing</button>
    </footer>
  </dialog>;
}
