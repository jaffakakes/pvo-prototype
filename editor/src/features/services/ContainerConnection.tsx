import { useEffect, useState } from "react";
import type { PublishedServiceOperations } from "../../../../packages/pvo-assistant/attachments/index.js";
import { componentLanguageSource } from "../../domain/components/languageCompilation";
import { nativeValueFingerprint } from "../../domain/assistant/native/context";
import { readContainerOperations } from "../../infrastructure/services/attachments";
import { useCapture } from "../../state/captureStore";
import { useAuthGate } from "../../state/auth/authGateStore";
import { ConnectionForm } from "./ConnectionForm";
import styles from "./ServicesPanel.module.css";

export function ContainerConnection({
  ownerId,
  serviceId,
}: {
  ownerId: string;
  serviceId: string;
}) {
  const localId = useCapture((state) => state.localId);
  const scenes = useCapture((state) => state.scenes);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<{
    key: string;
    value: PublishedServiceOperations | null;
    error: string | null;
  } | null>(null);
  const [componentKey, setComponentKey] = useState("");
  const [operation, setOperation] = useState("");
  const [connected, setConnected] = useState(false);
  const key = `${ownerId}:${serviceId}:${localId}:${reload}`;
  useEffect(() => {
    const controller = new AbortController();
    setView({ key, value: null, error: null });
    setConnected(false);
    setOperation("");
    setComponentKey("");
    const valid = () =>
      !controller.signal.aborted && useAuthGate.getState().user?.id === ownerId;
    void readContainerOperations(ownerId, serviceId, controller.signal)
      .then((value) => {
        if (valid()) setView({ key, value, error: null });
      })
      .catch((failure) => {
        if (valid())
          setView({
            key,
            value: null,
            error:
              failure instanceof Error
                ? failure.message
                : "Couldn’t load this Container’s operations.",
          });
      });
    return () => controller.abort();
  }, [key, ownerId, serviceId]);
  const current = view?.key === key ? view : null;
  const options = scenes.flatMap((scene) =>
    scene.components
      .filter((component) => component.type !== "tooltip")
      .map((component) => ({
        key: JSON.stringify([scene.id, component.id]),
        sceneId: scene.id,
        component,
        label: `${scene.name} · ${component.fields.heading || component.fields.title || component.fields.prompt || component.type}`,
      })),
  );
  const selected = options.find((item) => item.key === componentKey);
  const receipt = current?.value?.operations.find(
    (item) => item.operation.name === operation,
  );
  return (
    <section className={styles.editor} aria-label="Connect this Container">
      <h4>Connect a component</h4>
      <p>
        Choose a component in this Container’s original project and map its
        fields to a published operation.
      </p>
      <button type="button" onClick={() => setReload((value) => value + 1)}>
        Refresh published operations
      </button>
      {!current?.value && !current?.error && (
        <p role="status">Loading operations…</p>
      )}
      {current?.error && <p role="alert">{current.error}</p>}
      {connected && (
        <p role="status">
          Component connected. You can try it from the editor.
        </p>
      )}
      {current?.value && (
        <>
          {!localId || !options.length ? (
            <p>Add a component to this project before connecting it.</p>
          ) : (
            <label>
              Component
              <select
                value={componentKey}
                onChange={(event) => {
                  setComponentKey(event.target.value);
                  setConnected(false);
                }}
              >
                <option value="">Choose a component</option>
                {options.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!current.value.operations.length ? (
            <p>This version has no public operations to connect.</p>
          ) : (
            <label>
              Published operation
              <select
                value={operation}
                onChange={(event) => {
                  setOperation(event.target.value);
                  setConnected(false);
                }}
              >
                <option value="">Choose an operation</option>
                {current.value.operations.map((item) => (
                  <option key={item.operation.name} value={item.operation.name}>
                    {item.operation.name} ·{" "}
                    {item.operation.access === "write"
                      ? "saves records"
                      : "reads records"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected && receipt && (
            <ConnectionForm
              key={`${key}:${selected.key}:${receipt.identity.resourceId}:${operation}:${nativeValueFingerprint(componentLanguageSource(selected.component))}`}
              receipt={receipt}
              component={selected.component}
              sceneId={selected.sceneId}
              onConnected={() => setConnected(true)}
            />
          )}
        </>
      )}
    </section>
  );
}
