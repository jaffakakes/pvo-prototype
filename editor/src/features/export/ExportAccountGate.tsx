import { useState } from "react";
import {
  refreshAccountSession,
  useAuthGate,
} from "../../state/auth/authGateStore";
import { ClerkEmailSignIn } from "../auth/ClerkEmailSignIn";
import { AccountDisclosure } from "../auth/AccountDisclosure";
import { AuthProviders } from "../auth/AuthProviders";
import { useGoogleSignIn } from "../auth/useGoogleSignIn";
import { exportClock } from "./presentation";
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
export function ExportAccountGate({
  projectName,
  format,
  quality,
  duration,
  sceneCount,
  coverImage,
}: Props) {
  const {
    phase,
    available,
    clerkAvailable,
    clerkPublishableKey,
    error,
    connecting,
  } = useAuthGate();
  const [emailOpen, setEmailOpen] = useState(false);
  const beginGoogle = useGoogleSignIn();

  return (
    <div className={styles.gate} data-export-account-gate>
      <div
        className={styles.summary}
        role="group"
        aria-label="Selected export settings"
      >
        <span className={styles.poster}>
          {coverImage && <img src={coverImage} alt="" />}
        </span>
        <span className={styles.summaryCopy}>
          <strong>{projectName || "Untitled video"}</strong>
          <small>
            {format === "pvo" ? ".pvo" : ".mp4"} · {quality} ·{" "}
            {exportClock(duration, false)}
            <span className={styles.desktopScenes}>
              {" "}
              · {sceneCount} scene{sceneCount === 1 ? "" : "s"}
            </span>
          </small>
        </span>
        <span className={styles.ready}>✓ READY</span>
      </div>
      {emailOpen && clerkPublishableKey ? (
        <ClerkEmailSignIn
          publishableKey={clerkPublishableKey}
          mode="signin"
          onBack={() => setEmailOpen(false)}
        />
      ) : (
        <AuthProviders
          googleDisabled={phase === "checking" || !available || connecting}
          emailDisabled={
            phase === "checking" ||
            !clerkAvailable ||
            !clerkPublishableKey ||
            connecting
          }
          connecting={connecting}
          onGoogle={() => beginGoogle()}
          onEmail={() => setEmailOpen(true)}
        />
      )}
      {!emailOpen && <AccountDisclosure className={styles.disclosure} />}
      {!emailOpen && (
        <p className={styles.signIn}>
          Already have an account?{" "}
          <button
            type="button"
            disabled={
              phase === "checking" ||
              !clerkAvailable ||
              !clerkPublishableKey ||
              connecting
            }
            onClick={() => setEmailOpen(true)}
          >
            Sign in
          </button>
        </p>
      )}
      {phase === "checking" && (
        <p role="status" className={styles.status}>
          Checking your account…
        </p>
      )}
      {phase === "ready" && !available && !clerkAvailable && (
        <p className={styles.status}>
          Sign-in isn't configured here yet. Your edit is still saved in this
          browser.
        </p>
      )}
      {phase === "ready" && available && !clerkAvailable && (
        <p className={styles.status}>
          Email sign-in isn't configured here yet.
        </p>
      )}
      {error && !emailOpen && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {phase === "error" && (
        <button
          type="button"
          className={styles.retry}
          onClick={() => {
            void refreshAccountSession().catch(() => {});
          }}
        >
          Retry account check
        </button>
      )}
    </div>
  );
}
