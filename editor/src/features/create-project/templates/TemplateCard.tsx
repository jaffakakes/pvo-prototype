import type { CSSProperties } from "react";
import type { ProjectTemplate } from "../../../domain/project/templates";
import { GhostFrame } from "./GhostFrame";
import styles from "./TemplateRow.module.css";

type Props = {
  template: ProjectTemplate;
  disabled: boolean;
  leaving: boolean;
  entering: boolean;
  onSelect(template: ProjectTemplate): void;
};

function sceneCount(template: ProjectTemplate) {
  return `${template.scenes} ${template.scenes === 1 ? "scene" : "scenes"}`;
}

function formatDuration(duration = 0) {
  const minutes = Math.floor(duration / 60);
  const seconds = String(Math.round(duration % 60)).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function templateMeta(template: ProjectTemplate) {
  if (template.interactive) return `${template.behaviour} · ${sceneCount(template)}`;
  return `${sceneCount(template)} · ${formatDuration(template.duration)}`;
}

export function TemplateCard({ template, disabled, leaving, entering, onSelect }: Props) {
  const posterStyle = { "--poster": template.posterColor } as CSSProperties;
  const descriptionId = `template-${template.id}-meta`;
  return <button
    type="button"
    className={styles.card}
    data-template-card={template.id}
    data-transition={leaving ? "leaving" : entering ? "entering" : undefined}
    disabled={disabled}
    onClick={() => onSelect(template)}
    aria-label={`Use ${template.title} template`}
    aria-describedby={descriptionId}
  >
    <span className={styles.poster} style={posterStyle} data-template-poster data-poster={Boolean(template.poster)}>
      {template.poster && <img src={template.poster} alt="" />}
      <GhostFrame template={template} />
      <span className={styles.ratio}>{template.ratio}</span>
    </span>
    <span className={styles.body}>
      <strong>{template.title}</strong>
      <span id={descriptionId}>{templateMeta(template)}</span>
    </span>
  </button>;
}
