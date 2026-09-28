import { useState, type CSSProperties } from "react";
import { PROJECT_TEMPLATES, type ProjectTemplate } from "../../domain/project/templates";
import { ClipPoster } from "../../ui/media/ClipPoster";
import styles from "./TemplateGallery.module.css";

type Props = { disabled: boolean; onSelect(template: ProjectTemplate): void };

export function TemplateGallery({ disabled, onSelect }: Props) {
  const [filter, setFilter] = useState("all");
  const [browsing, setBrowsing] = useState(false);
  const templates = PROJECT_TEMPLATES.filter(item => filter === "all" || (filter === "interactive" ? item.interactive : item.ratio === filter));
  return <section className={styles.gallery} aria-labelledby="templates-title">
    <div className={styles.heading}>
      <h2 id="templates-title">Or start from a template</h2>
      <button type="button" aria-expanded={browsing} onClick={() => { setBrowsing(!browsing); setFilter("all"); }}>{browsing ? "Close filters" : "Browse all"}</button>
    </div>
    {browsing && <div className={styles.filters} role="group" aria-label="Filter templates">
      {[["all", "All templates"], ["9:16", "Portrait"], ["1:1", "Square"], ["16:9", "Landscape"], ["interactive", "Interactive"]].map(([id, label]) =>
        <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
    </div>}
    <div className={styles.grid}>
      {templates.map(template => <button key={template.id} type="button" className={styles.card} disabled={disabled}
        onClick={() => onSelect(template)} aria-label={`Use ${template.title} template`}>
        <div className={styles.poster} style={{ "--poster": template.color } as CSSProperties}>
          <ClipPoster clip={{ url: new URL("./samples/restyle-sample.mp4", location.href).href, in: 0, color: template.color }} />
          {template.interactive && <span className={styles.interactive}>✦ Interactive</span>}
          <div className={styles.ghost} data-ratio={template.ratio} aria-hidden="true">
            <i data-choice={template.interactive} /><i />
          </div>
          <span className={styles.ratio}>{template.ratio}</span>
        </div>
        <div className={styles.body}><strong>{template.title}</strong><span>{template.interactive ? "Interactive · " : ""}{template.scenes} {template.scenes === 1 ? "scene" : "scenes"}</span></div>
      </button>)}
    </div>
  </section>;
}
