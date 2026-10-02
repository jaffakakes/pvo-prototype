import { useRef, type KeyboardEvent } from "react";
import styles from "./TemplateRow.module.css";

export type TemplateFilter = "all" | "portrait" | "square" | "landscape" | "interactive";

const FILTERS: readonly { id: TemplateFilter; label: string }[] = [
  { id: "all", label: "All templates" },
  { id: "portrait", label: "Portrait" },
  { id: "square", label: "Square" },
  { id: "landscape", label: "Landscape" },
  { id: "interactive", label: "Interactive" },
];

type Props = {
  filter: TemplateFilter;
  count: number;
  open: boolean;
  onSelect(filter: TemplateFilter): void;
  onClose(): void;
};

export function FilterRow({ filter, count, open, onSelect, onClose }: Props) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % FILTERS.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + FILTERS.length) % FILTERS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = FILTERS.length - 1;
    else return;
    event.preventDefault();
    onSelect(FILTERS[nextIndex].id);
    window.requestAnimationFrame(() => tabs.current[nextIndex]?.focus());
  };

  return <div id="template-filters" className={styles.filterRow}>
    <div className={styles.tabList} role="tablist" aria-label="Filter templates">
      {FILTERS.map((option, index) => <button
        ref={element => { tabs.current[index] = element; }}
        key={option.id}
        id={`template-filter-${option.id}`}
        type="button"
        role="tab"
        aria-selected={filter === option.id}
        aria-controls="template-grid"
        tabIndex={open && filter === option.id ? 0 : -1}
        className={styles.filter}
        data-on={filter === option.id}
        onClick={() => onSelect(option.id)}
        onKeyDown={event => moveSelection(event, index)}
      >{option.label}</button>)}
    </div>
    <div className={styles.filterActions}>
      <span className={styles.count} role="status">{count} {count === 1 ? "template" : "templates"}</span>
      <i aria-hidden="true" />
      <button type="button" tabIndex={open ? 0 : -1} onClick={onClose}>Close filters</button>
    </div>
  </div>;
}
