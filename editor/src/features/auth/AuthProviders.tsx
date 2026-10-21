import styles from "./AuthProviders.module.css";

type Props = {
  googleDisabled: boolean;
  emailDisabled: boolean;
  connecting: boolean;
  onGoogle(): void;
  onEmail(): void;
};

export function AuthProviders({
  googleDisabled,
  emailDisabled,
  connecting,
  onGoogle,
  onEmail,
}: Props) {
  return (
    <div className={styles.providers}>
      <button
        type="button"
        className={styles.provider}
        disabled={googleDisabled}
        onClick={onGoogle}
      >
        <span className={styles.icon}>
          <GoogleMark />
        </span>
        <span>
          {connecting ? "Waiting for Google…" : "Continue with Google"}
        </span>
      </button>
      <button
        type="button"
        className={`${styles.provider} ${styles.email}`}
        disabled={emailDisabled}
        onClick={onEmail}
      >
        <span className={styles.icon} aria-hidden="true">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7.5 9 6 9-6" />
          </svg>
        </span>
        <span>Continue with email</span>
      </button>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#ffc107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"
      />
      <path
        fill="#ff3d00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4caf50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976d2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C41.4 34.9 44 29.8 44 24c0-1.3-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
