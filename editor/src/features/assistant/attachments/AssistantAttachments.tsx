import { useEffect, useRef, useState } from "react";
import { useAssistant } from "../../../state/assistant/assistantStore";
import { useAssistantScope } from "../../../state/assistant/sessionScope";
import { readAssistantAttachment } from "../../../infrastructure/assistant/readAttachment";
import { Icon } from "../../../ui/Icon";
import styles from "./AssistantAttachments.module.css";

export function AssistantAttachments({
  disabled,
  layout = "inline",
}: {
  disabled: boolean;
  layout?: "inline" | "composer";
}) {
  const attachments = useAssistant((state) => state.attachments);
  const epoch = useAssistantScope((state) => state.epoch);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const reading = useAssistant((state) => state.readingAttachments);
  const setReading = (readingAttachments: boolean) =>
    useAssistant.setState({ readingAttachments });
  const [error, setError] = useState("");
  useEffect(() => {
    generation.current++;
    setError("");
    setReading(false);
    return () => {
      generation.current++;
      setReading(false);
    };
  }, [epoch]);
  return (
    <div className={styles.attachments} data-layout={layout}>
      <input
        ref={input}
        hidden
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,.txt,.md,.csv,.json"
        aria-label="Attach photos or text files"
        onChange={async (event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (!files.length) return;
          if (files.length + attachments.length > 3) {
            setError("Attach up to 3 files per request.");
            return;
          }
          const attempt = ++generation.current;
          setReading(true);
          setError("");
          try {
            const next = await Promise.all(files.map(readAssistantAttachment));
            if (generation.current !== attempt) return;
            const combined = [...useAssistant.getState().attachments, ...next];
            const textBytes = combined.reduce(
              (size, item) =>
                size +
                (item.kind === "text"
                  ? new TextEncoder().encode(item.text).length
                  : 0),
              0,
            );
            if (textBytes > 24000)
              throw new Error("Keep text attachments under 24 KB in total.");
            useAssistant.setState({ attachments: combined });
          } catch (failure) {
            if (generation.current === attempt)
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Could not read this attachment.",
              );
          } finally {
            if (generation.current === attempt) setReading(false);
          }
        }}
      />
      <button
        type="button"
        className={styles.add}
        aria-label="Add a photo or file"
        title="Photos or text files · up to 3"
        disabled={disabled || reading || attachments.length >= 3}
        onClick={() => input.current?.click()}
      >
        <Icon name="plus" size={16} />
      </button>
      {attachments.length > 0 && (
        <div className={styles.files}>
          {attachments.map((item, index) => (
            <button
              type="button"
              key={`${index}-${item.name}`}
              className={styles.file}
              disabled={disabled}
              title={`Remove ${item.name}`}
              aria-label={`Remove attachment ${item.name}`}
              onClick={() =>
                useAssistant.setState((state) => ({
                  attachments: state.attachments.filter(
                    (_, at) => at !== index,
                  ),
                }))
              }
            >
              {item.kind === "image" ? (
                <img src={item.dataUrl} alt={item.name} />
              ) : (
                <span>{item.name}</span>
              )}
              <Icon name="close" size={10} />
            </button>
          ))}
        </div>
      )}
      {(reading || error) && (
        <p className={styles.feedback} role="status">
          {reading ? "Reading attachments…" : error}
        </p>
      )}
    </div>
  );
}
