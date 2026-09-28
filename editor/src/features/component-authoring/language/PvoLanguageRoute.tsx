import { useState } from "react";
import { type PvoLanguageSource } from "../../../domain/components/languageSource";
import type { PvoComponent } from "../../../domain/project/model";
import type { LanguageFeedback } from "./usePvoCompilation";
import { PvoSourceEditor } from "./PvoSourceEditor";
import styles from "./PvoLanguageRoute.module.css";

type LanguageTab = keyof PvoLanguageSource;

const TABS: { key: LanguageTab; label: string }[] = [
  { key: "structure", label: "Structure" },
  { key: "style", label: "Style" },
  { key: "logic", label: "Logic" },
];

const HELP: Record<LanguageTab, string> = {
  structure: "Use this component's own tags. Plain text cannot trigger an action.",
  style: "Starter rules match the current look. Edit colours, font size or corners; changes appear in the preview.",
  logic: "Write event rules in PVO using continue(), jump_to(), go_to_scene() or request({...}).",
};

function logicHelp(component: PvoComponent): string {
  if (component.type === "tooltip")
    return "Tooltip is display-only, so it has no Logic events. Use a Card for a button.";
  if (component.type === "card" && !component.fields.buttons?.length && !component.code?.custom)
    return "Add a button in Content to generate an on press(...) rule, or add one in Structure and Logic.";
  return HELP.logic;
}

export function PvoLanguageRoute({ component, source, onEdit, feedback, expanded, onExpand, onRestore,
  onSourceBlur, assistantActive = false, registerAssistantTarget, readOnly = false, initialTab = "structure" }: {
  component: PvoComponent;
  source: PvoLanguageSource;
  onEdit: (tab: LanguageTab, value: string) => void;
  feedback: LanguageFeedback;
  expanded: boolean;
  onExpand: () => void;
  readOnly?: boolean;
  onRestore?: () => void;
  initialTab?: LanguageTab;
  assistantActive?: boolean;
  registerAssistantTarget?: (target: HTMLDivElement | null) => void;
  onSourceBlur?: () => void;
}) {
  const [tab, setTab] = useState<LanguageTab>(initialTab);
  const value = source[tab];

  return <div className={styles.route}>
    <div className={styles.tabs} role="tablist" aria-label="PVO language" {...(assistantActive ? { inert: "" } : {})}>
      {TABS.map(item => <button
        key={item.key}
        type="button"
        role="tab"
        aria-selected={tab === item.key}
        data-on={tab === item.key}
        onClick={() => setTab(item.key)}
      >{item.label}</button>)}
    </div>
    <p className={styles.help}>{tab === "logic" ? logicHelp(component) : HELP[tab]}</p>
    <PvoSourceEditor
      key={tab}
      part={tab}
      label={`${TABS.find(item => item.key === tab)?.label} source`}
      value={value}
      readOnly={readOnly || tab === "logic" && component.type === "tooltip"}
      placeholder={tab === "logic" && component.type === "tooltip" ? "No Logic for a display-only Tooltip" : tab === "logic" && !value ? "Add a control in Structure to write an event rule" : undefined}
      onChange={next => onEdit(tab, next)}
      onBlur={onSourceBlur}
      expanded={expanded}
      onExpand={onExpand}
      disabled={assistantActive}
      registerAssistantTarget={registerAssistantTarget}
    />
    {!readOnly && <div className={styles.status} data-state={feedback.state} role={feedback.state === "invalid" ? "alert" : "status"}
      {...(assistantActive ? { inert: "" } : {})}>
      <span>{feedback.state === "checking" ? "Checking…" : feedback.state === "valid" ? "✓ Valid · preview updated" : `✕ ${feedback.message}`}</span>
      {feedback.state === "invalid" && feedback.part && <button type="button" onClick={() => setTab(feedback.part!)}>Open {feedback.part}</button>}
      {feedback.state === "invalid" && onRestore && <button type="button" onClick={onRestore}>Restore previous version</button>}
    </div>}
  </div>;
}
