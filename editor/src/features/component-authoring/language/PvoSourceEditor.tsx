import type { KeyboardEvent } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { tokenizePvo } from "./highlightPvo";
import styles from "./PvoSourceEditor.module.css";

type SourcePart = "structure" | "style" | "logic";

type PvoSourceEditorProps = {
  value: string;
  part: SourcePart;
  label: string;
  readOnly?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  expanded: boolean;
  onExpand: () => void;
  disabled?: boolean;
  registerAssistantTarget?: (target: HTMLDivElement | null) => void;
};

export function PvoSourceEditor({
  value,
  part,
  label,
  readOnly = false,
  placeholder,
  onChange,
  onBlur,
  expanded,
  onExpand,
  disabled = false,
  registerAssistantTarget,
}: PvoSourceEditorProps) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const highlight = useRef<HTMLPreElement>(null);
  const lineNumbers = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<{ part: SourcePart; position: number } | null>(null);
  const tokens = useMemo(() => tokenizePvo(value, part), [value, part]);
  const lineCount = Math.max(1, value.split("\n").length);

  const syncScroll = useCallback(() => {
    const area = editor.current;
    const mirror = highlight.current;
    if (!area || !mirror) return;

    // Exclude native scrollbars so both layers have the same scroll limits.
    mirror.style.width = `${area.clientWidth}px`;
    mirror.style.height = `${area.clientHeight}px`;
    mirror.scrollTop = area.scrollTop;
    mirror.scrollLeft = area.scrollLeft;
    if (lineNumbers.current) {
      lineNumbers.current.style.transform = `translateY(${-area.scrollTop}px)`;
    }
  }, []);

  useLayoutEffect(() => {
    const area = editor.current;
    if (!area) return;
    const observer = new ResizeObserver(syncScroll);
    observer.observe(area);
    syncScroll();
    return () => observer.disconnect();
  }, [part, syncScroll]);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret) {
      if (caret.part === part) editor.current?.setSelectionRange(caret.position, caret.position);
      pendingCaret.current = null;
    }
    syncScroll();
  }, [value, part, expanded, syncScroll]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || readOnly) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    const area = event.currentTarget;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    // Native selection offsets use LF even when loaded source contains CRLF.
    const current = area.value;
    const next = current.slice(0, start) + "  " + current.slice(end);
    pendingCaret.current = { part, position: start + 2 };
    onChange(next);
    if (next === current) {
      area.setSelectionRange(start + 2, start + 2);
      pendingCaret.current = null;
    }
  };

  return <div className={styles.frame} data-pvo-source-editor data-pvo-source-part={part} data-expanded={expanded}>
    <div className={styles.gutter} aria-hidden="true">
      <div ref={lineNumbers}>
        {Array.from({ length: lineCount }, (_, index) => <span key={index}>{index + 1}</span>)}
      </div>
    </div>
    <div className={styles.surface} {...(disabled ? { inert: "" } : {})}>
      <pre ref={highlight} className={styles.highlight} data-pvo-highlight aria-hidden="true">
        {tokens.map((token, index) => <span key={index} className={styles[token.kind]} data-token={token.kind}>{token.text}</span>)}
        {/* A final blank line needs a glyph for the pre to match textarea height. */}
        {value.endsWith("\n") ? " " : null}
      </pre>
      <textarea
        key={part}
        ref={editor}
        className={styles.textarea}
        aria-label={label}
        aria-description={readOnly ? undefined : "Tab inserts two spaces. Shift+Tab moves to the previous control."}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        wrap="off"
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={event => onChange(event.currentTarget.value)}
        onBlur={event => {
          // Expanding the same editor or opening its orb is still this editing session.
          const target = event.relatedTarget;
          if (!(target instanceof Element) || !target.closest("[data-pvo-source-editor]")) onBlur?.();
        }}
        onKeyDown={onKeyDown}
        onScroll={syncScroll}
      />
    </div>
    <button
      className={styles.expand}
      type="button"
      onClick={onExpand}
      aria-label={expanded ? "Collapse language editor" : "Expand language editor"}
      aria-expanded={expanded}
      disabled={disabled}
    >{expanded ? "✕" : "⤢"}</button>
    {expanded && <div ref={registerAssistantTarget} className={styles.assistantTarget} />}
  </div>;
}
