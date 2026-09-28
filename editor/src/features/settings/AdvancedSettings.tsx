import { useId,useRef,useState } from "react";
import { checkedDomains } from "../../domain/components/actions";
import { useCapture } from "../../state/captureStore";
import styles from "./AdvancedSettings.module.css";

function sameDomains(left: string[], right: string[]) {
  return left.length === right.length && left.every((host, index) => host === right[index]);
}

export function AdvancedSettings() {
  const allowedDomains = useCapture(state => state.allowedDomains);
  const [draft, setDraft] = useState(() => allowedDomains.join(", "));
  const [error, setError] = useState<string | null>(null);
  const hasUndoStep = useRef(false);
  const fieldId = useId();
  const noteId = useId();

  const changeDomains = (value: string) => {
    setDraft(value);

    let domains: string[];
    try {
      domains = checkedDomains(value.split(","));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enter host names only.");
      return;
    }

    setError(null);
    const state = useCapture.getState();
    if (sameDomains(state.allowedDomains, domains)) return;

    if (hasUndoStep.current) state.patch({ allowedDomains: domains });
    else {
      state.edit({ allowedDomains: domains });
      hasUndoStep.current = true;
    }
  };

  return <section className={styles.section} aria-labelledby={`${fieldId}-heading`}>
    <h3 id={`${fieldId}-heading`}>Advanced</h3>
    <p className={styles.intro}>Allowed hosts for PVO Logic requests, shared by every component in this PVO.</p>
    <div className={styles.domainBox} data-error={!!error}>
      <label htmlFor={fieldId}>Allowed request domains</label>
      <input
        id={fieldId}
        type="text"
        value={draft}
        placeholder="api.example.com, localhost:8080"
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={!!error}
        aria-describedby={noteId}
        onChange={event => changeDomains(event.target.value)}
      />
      <p id={noteId} role={error ? "alert" : undefined}>
        {error ? `Not saved — ${error}` : "Separate hosts with commas. Include a non-default port when used; no https:// or paths. Fields request hosts are added automatically."}
      </p>
    </div>
  </section>;
}
