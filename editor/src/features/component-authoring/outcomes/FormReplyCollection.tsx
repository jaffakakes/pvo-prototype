import { useEffect, useRef, useState } from "react";
import { isCodeOwned, returnToVisualEditing } from "../../../domain/components/codeOwnership";
import { fieldsShownFor } from "../../../domain/components/fields";
import { collectReplyStartingFields } from "../../../domain/components/forms";
import type { ComponentFields, PlaybackOutcome, PvoComponent } from "../../../domain/project/model";
import { createRepliesClient } from "../../../infrastructure/replies/client";
import { refreshAccountSession, requireAccount, useAuthGate } from "../../../state/auth/authGateStore";
import { useCapture } from "../../../state/captureStore";
import styles from "./FormReplyCollection.module.css";

const CONTINUE: PlaybackOutcome = { kind: "continue" };

function discardUnusedBox(client: ReturnType<typeof createRepliesClient>, id: string): void {
  void client.deleteBox(id).catch(error => console.warn(`Couldn’t discard unused reply box ${id}:`, error));
}

function localOutcome(fields: ComponentFields): PlaybackOutcome {
  return fields.outcome?.kind === "continue" || fields.outcome?.kind === "time" || fields.outcome?.kind === "scene"
    ? fields.outcome : fields.successOutcome ?? CONTINUE;
}

/** A creator deliberately provisions one owner-scoped public reply destination. */
export function FormReplyCollection({ component, fields }: { component: PvoComponent; fields: ComponentFields }) {
  const [client] = useState(() => createRepliesClient());
  const accountAvailable = useAuthGate(state => state.available || state.clerkAvailable);
  const collecting = fields.formSubmitMode === "collect";
  const codeOwned = isCodeOwned(component);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replaceAdvanced, setReplaceAdvanced] = useState(false);
  const active = useRef<AbortController | null>(null);

  useEffect(() => () => active.current?.abort(), []);

  const setLocal = () => {
    const state = useCapture.getState();
    const current = state.scenes.flatMap(scene => scene.components).find(item => item.id === component.id);
    if (!current || current.type !== "form") return;
    const shown = fieldsShownFor(current);
    const outcome = shown.successOutcome ?? localOutcome(shown);
    state.updateComponent(component.id, { fields: {
      ...shown, formSubmitMode: "local", destination: "", outcome, successOutcome: outcome,
    } });
    setError(null);
  };

  const collect = async (replaceCode: boolean) => {
    if (busy) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      const account = await refreshAccountSession();
      if ((account.available || account.clerkAvailable) && !await requireAccount("replies")) return;
      controller.signal.throwIfAborted();
      const title = collectReplyStartingFields(fields).heading?.trim().slice(0, 120) || "Video replies";
      const box = await client.createBox(title, controller.signal);
      if (controller.signal.aborted) {
        discardUnusedBox(client, box.id);
        return;
      }
      const state = useCapture.getState();
      const current = state.scenes.flatMap(scene => scene.components).find(item => item.id === component.id);
      if (!current || current.type !== "form" || fieldsShownFor(current).formSubmitMode === "collect"
        || (isCodeOwned(current) && !replaceCode)) {
        discardUnusedBox(client, box.id);
        return;
      }
      const visual = replaceCode ? returnToVisualEditing(current) : null;
      const starting = collectReplyStartingFields(visual?.fields ?? fieldsShownFor(current));
      const next = {
        ...starting,
        formSubmitMode: "collect" as const,
        destination: box.url,
        successOutcome: localOutcome(starting),
        failureOutcome: null,
      };
      try {
        state.updateComponent(component.id, { ...(visual ?? {}), fields: next });
        setReplaceAdvanced(false);
      } catch (failure) {
        discardUnusedBox(client, box.id);
        throw failure;
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn’t set up Collect replies.");
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };

  return <section className={styles.section} aria-label="Reply collection">
    {collecting ? <>
      <div className={styles.card} data-selected="true">
        <strong>Collect replies is on</strong>
        <p>Viewer answers are sent to your Restyle Replies inbox.</p>
        <button type="button" disabled={busy || codeOwned} onClick={setLocal}>Keep answers in this video instead</button>
        <p>This changes the current edit. Videos already shared with this reply box can still receive answers.</p>
      </div>
      <p className={styles.note}>{accountAvailable
        ? "Open More → Replies to read them. Replies and boxes are deleted after 180 days. Sign in again if your session expires."
        : "Open More → Replies to read them. Replies and boxes are deleted after 180 days. Clearing site data loses this browser’s access."}</p>
    </> : <>
      <div className={styles.card}>
        <strong>Collect replies</strong>
        <p>Send answers to your Restyle inbox. Restyle sets up the receiving address for you.</p>
        {codeOwned ? <>
          {!replaceAdvanced ? <button type="button" disabled={busy} onClick={() => setReplaceAdvanced(true)}>
            Replace Advanced form and set up replies…
          </button> : <div className={styles.confirm}>
            <p>This replaces the Advanced form and its look with visual editing. Its source stays archived in the project.</p>
            <button type="button" disabled={busy} onClick={() => { void collect(true); }}>
              {busy ? "Setting up…" : "Replace and collect replies"}
            </button>
            <button type="button" disabled={busy} onClick={() => setReplaceAdvanced(false)}>Keep Advanced form</button>
          </div>}
        </> : <button type="button" disabled={busy} onClick={() => { void collect(false); }}>
          {busy ? "Setting up…" : "Set up Collect replies"}
        </button>}
      </div>
      <p className={styles.note}>{accountAvailable
        ? "Setup needs an online connection and sign-in. Replies are available on your devices and deleted after 180 days."
        : "Setup needs an online connection. This beta keeps inbox access in this browser; replies are deleted after 180 days."}</p>
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
