import { useRef } from "react";
import { componentLanguageSource } from "../../../domain/components/languageCompilation";
import type { PvoLanguageSource } from "../../../domain/components/languageSource";
import type { PvoComponent } from "../../../domain/project/model";
import { editComponentSource } from "../../../state/components/componentLanguageCommands";
import { PvoSourceEditor } from "../../component-authoring/language/PvoSourceEditor";
import { usePvoFormatting } from "../../component-authoring/language/usePvoFormatting";
import type { LanguageFeedback } from "../../component-authoring/language/usePvoCompilation";
import styles from "./CodeSheet.module.css";

export function CodeSheet({
  component,
  part,
  onPart,
  logic,
  feedback,
  expanded,
  onExpand,
  onRestore,
}: {
  component: PvoComponent;
  part: keyof PvoLanguageSource;
  onPart(part: keyof PvoLanguageSource): void;
  logic: boolean;
  feedback: LanguageFeedback;
  expanded: boolean;
  onExpand(): void;
  onRestore?: () => void;
}) {
  const edited = useRef(false);
  const formatting = usePvoFormatting(
    component,
    true,
    feedback.state === "valid",
  );
  const source = componentLanguageSource(component);
  const files = [
    { id: "structure", suffix: "html" },
    { id: "style", suffix: "css" },
    ...(logic ? [{ id: "logic", suffix: "logic" }] : []),
  ] as const;
  return (
    <div className={styles.codeSheet}>
      <div
        className={styles.fileTabs}
        role="tablist"
        aria-label="Component source files"
      >
        {files.map((file) => (
          <button
            key={file.id}
            role="tab"
            type="button"
            aria-selected={part === file.id}
            onClick={() => {
              edited.current = false;
              onPart(file.id as keyof PvoLanguageSource);
            }}
          >
            {component.type}.{file.suffix}
          </button>
        ))}
      </div>
      <PvoSourceEditor
        value={source[part]}
        part={part}
        label={`Component ${part} code`}
        tone="light"
        expanded={expanded}
        onExpand={onExpand}
        onBlur={() => {
          formatting.onBlur();
          edited.current = false;
        }}
        onChange={(value) => {
          formatting.onEdit();
          if (!editComponentSource(component.id, part, value, !edited.current))
            return;
          edited.current = true;
        }}
      />
      <div
        className={styles.validity}
        data-state={feedback.state}
        role="status"
      >
        <strong>
          {feedback.state === "checking"
            ? "Checking…"
            : feedback.state === "valid"
              ? "Valid · preview updated"
              : feedback.message}
        </strong>
        {feedback.state === "invalid" && (
          <div>
            {feedback.part && (
              <button type="button" onClick={() => onPart(feedback.part!)}>
                Open {feedback.part}
              </button>
            )}
            {onRestore && (
              <button type="button" onClick={onRestore}>
                Restore previous version
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
