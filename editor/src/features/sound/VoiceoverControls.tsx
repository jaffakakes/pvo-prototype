import { useEffect } from "react";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { useVoiceover } from "./useVoiceover";
import styles from "./VoiceoverControls.module.css";

export function VoiceoverControls() {
  const voice = useVoiceover();
  const busy = voice.phase !== "idle";
  const close = () =>
    useCapture.getState().patch({ sheet: null, playing: false });
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (busy) {
        voice.cancel();
        close();
      } else close();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, voice.cancel]);
  return (
    <div
      className={`${cx("toolBar")} ${styles.controls}`}
      role="group"
      aria-label="Voiceover"
      data-voiceover-busy={busy}
    >
      {voice.draft && !busy ? (
        <>
          <button className={styles.quiet} onClick={voice.discard}>
            Discard recording
          </button>
          <button className={styles.done} onClick={voice.retry}>
            Retry saving
          </button>
          <button className={styles.quiet} onClick={close}>
            Done
          </button>
        </>
      ) : (
        <>
          <button
            className={styles.noise}
            aria-pressed={voice.noise}
            disabled={busy}
            onClick={() => voice.setNoise(!voice.noise)}
          >
            <Icon name="speaker" size={22} />
            <span>Reduce noise</span>
          </button>
          <button
            className={styles.record}
            data-recording={voice.phase === "recording"}
            aria-label={
              voice.phase === "recording"
                ? "Stop voiceover"
                : "Record voiceover"
            }
            disabled={voice.phase === "permission" || voice.phase === "saving"}
            onClick={
              voice.phase === "recording"
                ? voice.stop
                : () => void voice.record()
            }
          >
            <i />
          </button>
          <button className={styles.done} disabled={busy} onClick={close}>
            Done
          </button>
        </>
      )}
      <span
        className={styles.status}
        role="status"
        aria-live={voice.phase === "recording" ? "off" : "polite"}
      >
        {voice.phase === "permission"
          ? "Waiting for microphone…"
          : voice.phase === "saving"
            ? "Saving…"
            : voice.phase === "recording"
              ? `${voice.elapsed.toFixed(1)}s / 60s`
              : ""}
      </span>
    </div>
  );
}
