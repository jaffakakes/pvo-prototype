import { useState } from "react";
import { refreshAccountSession, useAuthGate } from "../../state/auth/authGateStore";
import { ClerkEmailSignIn } from "../auth/ClerkEmailSignIn";
import { AccountDisclosure } from "../auth/AccountDisclosure";
import { useGoogleSignIn } from "../auth/useGoogleSignIn";
import { exportClock } from "./ExportPreview";
import styles from "./ExportAccountGate.module.css";

type Props = {
  projectName: string;
  format: "video" | "pvo";
  quality: "720p" | "1080p" | "4K";
  duration: number;
  sceneCount: number;
  coverImage: string | null;
};

/** The export sheet keeps its selected settings visible while account creation completes. */
export function ExportAccountGate({ projectName, format, quality, duration, sceneCount, coverImage }: Props) {
  const { phase, available, clerkAvailable, clerkPublishableKey, error, connecting } = useAuthGate();
  const [emailOpen, setEmailOpen] = useState(false);
  const beginGoogle = useGoogleSignIn();

  return <div className={styles.gate} data-export-account-gate>
    <p id="export-gate-description" className={styles.description}>Your edit stays right here in this browser — sign in and we pick up exactly where you left off.</p>
    <div className={styles.summary} role="group" aria-label="Selected export settings">
      <span className={styles.poster}>{coverImage && <img src={coverImage} alt="" />}</span>
      <span className={styles.summaryCopy}>
        <strong>{projectName || "Untitled video"}</strong>
        <small>{format === "pvo" ? ".pvo" : ".mp4"} · {quality} · {exportClock(duration, false)}<span className={styles.desktopScenes}> · {sceneCount} scene{sceneCount === 1 ? "" : "s"}</span></small>
      </span>
      <span className={styles.ready}>✓ READY</span>
    </div>
    {emailOpen && clerkPublishableKey ? <ClerkEmailSignIn publishableKey={clerkPublishableKey} mode="signin"
      onBack={() => setEmailOpen(false)} /> : <div className={styles.providers}>
      <button type="button" className={styles.google} onClick={() => beginGoogle()}
        disabled={phase === "checking" || !available || connecting}>
        <span className={styles.googleMark} aria-hidden="true">G</span>
        <span>{connecting ? "Waiting for Google…" : "Continue with Google"}</span>
      </button>
      <button type="button" className={styles.emailButton} onClick={() => setEmailOpen(true)}
        disabled={phase === "checking" || !clerkAvailable || !clerkPublishableKey || connecting}>
        <span className={styles.emailMark} aria-hidden="true">@</span>
        <span>Continue with email</span>
      </button>
    </div>}
    <AccountDisclosure className={styles.disclosure} />
    {phase === "checking" && <p role="status" className={styles.status}>Checking your account…</p>}
    {phase === "ready" && !available && !clerkAvailable && <p className={styles.status}>Sign-in isn't configured here yet. Your edit is still saved in this browser.</p>}
    {phase === "ready" && available && !clerkAvailable && <p className={styles.status}>Email sign-in isn't configured here yet.</p>}
    {error && !emailOpen && <p className={styles.error} role="alert">{error}</p>}
    {phase === "error" && <button type="button" className={styles.retry}
      onClick={() => { void refreshAccountSession().catch(() => {}); }}>Retry account check</button>}
  </div>;
}
