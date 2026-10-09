import { useEffect, useRef, useState } from "react";
import {
  compilePvoComponent,
  type CompiledPvoComponent,
} from "../../../../packages/pvo-language/index.js";
import type {
  ServiceAttachmentReceipt,
  ServiceInputBinding,
} from "../../../../packages/pvo-assistant/attachments/index.js";
import type { PvoComponent } from "../../domain/project/model";
import { componentLanguageSource } from "../../domain/components/languageCompilation";
import {
  connectionFields,
  connectionTargets,
  defaultInputBinding,
} from "../../domain/services/connectionEditing";
import { connectContainerComponent } from "./connectionCommands";
import { ConnectionBinding } from "./ConnectionBinding";
import styles from "./ServicesPanel.module.css";

/** The parent keys this view to exact component source, project and checked operation. */
export function ConnectionForm({
  receipt,
  component,
  sceneId,
  onConnected,
}: {
  receipt: ServiceAttachmentReceipt;
  component: PvoComponent;
  sceneId: string;
  onConnected: () => void;
}) {
  const [compiled, setCompiled] = useState<CompiledPvoComponent | null>(null);
  const [binding, setBinding] = useState<ServiceInputBinding | null>(null);
  const [targetIndex, setTargetIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    void compilePvoComponent(component.type, componentLanguageSource(component))
      .then((value) => {
        if (controller.signal.aborted) return;
        setCompiled(value);
        setBinding(
          defaultInputBinding(
            receipt.operation.input,
            connectionFields(value.structure),
          ),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Finish or correct the component’s code before connecting it.",
          );
      });
    return () => {
      controller.abort();
      if (request.current === controller) request.current = null;
    };
  }, [component, receipt]);
  const targets = compiled ? connectionTargets(compiled) : [];
  async function connect() {
    const controller = request.current;
    if (!controller || !binding || !targets[targetIndex] || busy) return;
    setBusy(true);
    setError(null);
    try {
      await connectContainerComponent(
        receipt,
        sceneId,
        component.id,
        targets[targetIndex],
        binding,
        controller.signal,
      );
      onConnected();
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Couldn’t connect this component. Try again.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className={styles.editor}>
      {!compiled && !error && <p role="status">Checking component controls…</p>}
      {error && <p role="alert">{error}</p>}
      {compiled && !targets.length && (
        <p>
          This component has no unused control to connect. Choose another
          component, or change its current request action first.
        </p>
      )}
      {compiled && binding && targets.length > 0 && (
        <>
          <label>
            Component control
            <select
              disabled={busy}
              value={targetIndex}
              onChange={(event) => setTargetIndex(Number(event.target.value))}
            >
              {targets.map((target, index) => (
                <option key={`${target.event}:${target.target}`} value={index}>
                  {target.label || target.event}
                </option>
              ))}
            </select>
          </label>
          <p>{receipt.operation.description}</p>
          <ConnectionBinding
            schema={receipt.operation.input}
            binding={binding}
            fields={connectionFields(compiled.structure)}
            label="Input"
            disabled={busy}
            onChange={setBinding}
          />
          <p>
            Connecting changes this component in one Undo step. Try uses
            separate test records. Downloads and published videos use the
            Container’s live records.
          </p>
          <button type="button" disabled={busy} onClick={() => void connect()}>
            {busy ? "Connecting…" : "Connect component"}
          </button>
        </>
      )}
    </div>
  );
}
