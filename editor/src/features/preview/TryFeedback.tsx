import { useTryFeedback } from "./tryFeedbackStore";
import styles from "./PreviewFeedback.module.css";

export function TryFeedback({ componentId }: { componentId: string }) {
  const feedback = useTryFeedback(state => state.components[componentId]);
  if (!feedback) return null;
  const message = feedback.phase === "pending" ? "Sending…"
    : feedback.phase === "failed" ? "Request failed. Try again." : "Destination needs a clip.";
  return <span className={styles.request} data-try-feedback={feedback.phase}
    role="status" aria-live="polite">{message}</span>;
}
