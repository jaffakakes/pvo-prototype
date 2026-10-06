import { useEffect, useRef, useState } from "react";
import type { PvoComponent } from "../../domain/project/model";
import { readSavedSubmission, recoverSavedSubmission } from "./tryMode";
import {
  beginTryRequest,
  finishTryRequest,
  useTryFeedback,
} from "./tryFeedbackStore";
import styles from "./PreviewFeedback.module.css";

export function TryServiceRecovery({ component }: { component: PvoComponent }) {
  const phase = useTryFeedback(
    (state) => state.components[component.id]?.phase,
  );
  const [saved, setSaved] = useState<{ complete: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const currentComponent = useRef<PvoComponent | null>(component);
  useEffect(() => {
    currentComponent.current = component;
    return () => {
      currentComponent.current = null;
    };
  }, [component]);
  useEffect(() => {
    let current = true;
    void readSavedSubmission(component)
      .then((value) => {
        if (current) setSaved(value);
      })
      .catch(() => {
        if (current) {
          setSaved({ complete: false });
        }
      });
    return () => {
      current = false;
    };
  }, [component, phase]);
  if (!saved) return null;
  return (
    <div className={styles.recovery}>
      <button
        type="button"
        disabled={busy || phase === "pending"}
        onClick={async (event) => {
          event.stopPropagation();
          setBusy(true);
          try {
            await recoverSavedSubmission(component);
          } catch {
            if (currentComponent.current === component) {
              const operation = beginTryRequest(component.id);
              finishTryRequest(component.id, operation, true);
            }
          } finally {
            if (currentComponent.current === component) setBusy(false);
          }
        }}
      >
        {saved.complete ? "Show saved test result" : "Check saved test"}
      </button>
    </div>
  );
}
