import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PROJECT_TEMPLATES, type ProjectTemplate } from "../../../domain/project/templates";
import { FilterRow, type TemplateFilter } from "./FilterRow";
import { TemplateCard } from "./TemplateCard";
import styles from "./TemplateRow.module.css";

type Props = { disabled: boolean; onSelect(template: ProjectTemplate): void };

const FILTER_IDS: readonly TemplateFilter[] = ["all", "portrait", "square", "landscape", "interactive"];

function filterFromUrl(): TemplateFilter {
  if (typeof window === "undefined") return "all";
  const candidate = new URL(window.location.href).searchParams.get("filter");
  return FILTER_IDS.includes(candidate as TemplateFilter) ? candidate as TemplateFilter : "all";
}

function templatesFor(filter: TemplateFilter) {
  return PROJECT_TEMPLATES.filter(template => {
    if (filter === "portrait") return template.ratio === "9:16";
    if (filter === "square") return template.ratio === "1:1";
    if (filter === "landscape") return template.ratio === "16:9";
    if (filter === "interactive") return template.interactive;
    return true;
  });
}

function syncFilterToUrl(filter: TemplateFilter) {
  const url = new URL(window.location.href);
  if (filter === "all") url.searchParams.delete("filter");
  else url.searchParams.set("filter", filter);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function TemplateRow({ disabled, onSelect }: Props) {
  const initialFilter = useRef(filterFromUrl()).current;
  const [filter, setFilter] = useState<TemplateFilter>(initialFilter);
  const [renderedFilter, setRenderedFilter] = useState<TemplateFilter>(initialFilter);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(() => new Set());
  const transitionTimer = useRef<number | null>(null);
  const headerAction = useRef<HTMLButtonElement>(null);

  const changeFilter = (next: TemplateFilter, updateUrl = true) => {
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    transitionTimer.current = null;

    const currentTemplates = templatesFor(renderedFilter);
    const nextTemplates = templatesFor(next);
    const nextIds = new Set(nextTemplates.map(template => template.id));
    const currentIds = new Set(currentTemplates.map(template => template.id));
    const leaving = new Set(currentTemplates.filter(template => !nextIds.has(template.id)).map(template => template.id));
    const entering = new Set(nextTemplates.filter(template => !currentIds.has(template.id)).map(template => template.id));

    setFilter(next);
    setEnteringIds(new Set());
    if (updateUrl) syncFilterToUrl(next);

    if (!leaving.size) {
      setLeavingIds(new Set());
      setRenderedFilter(next);
      setEnteringIds(entering);
      return;
    }

    setLeavingIds(leaving);
    transitionTimer.current = window.setTimeout(() => {
      setRenderedFilter(next);
      setLeavingIds(new Set());
      setEnteringIds(entering);
      transitionTimer.current = null;
    }, 120);
  };

  useEffect(() => {
    const readUrl = () => {
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
      const next = filterFromUrl();
      setFilter(next);
      setRenderedFilter(next);
      setLeavingIds(new Set());
      setEnteringIds(new Set());
      setFiltersOpen(true);
    };
    window.addEventListener("popstate", readUrl);
    return () => {
      window.removeEventListener("popstate", readUrl);
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    };
  }, []);

  useEffect(() => {
    const candidate = new URL(window.location.href).searchParams.get("filter");
    if (candidate && !FILTER_IDS.includes(candidate as TemplateFilter)) syncFilterToUrl("all");
  }, []);

  const visibleTemplates = templatesFor(renderedFilter);
  const selectedTemplates = templatesFor(filter);
  const columns = Math.max(5, visibleTemplates.length);
  const compactColumns = Math.max(4, Math.min(visibleTemplates.length, 4));
  const gridStyle = {
    "--template-columns": columns,
    "--template-compact-columns": compactColumns,
  } as CSSProperties;

  const closeFilters = () => {
    setFiltersOpen(false);
    changeFilter("all");
    window.requestAnimationFrame(() => headerAction.current?.focus());
  };

  const useHeaderAction = () => {
    if (filtersOpen) changeFilter("all");
    else setFiltersOpen(true);
  };

  return <section className={styles.gallery} aria-labelledby="templates-title" data-template-gallery>
    <div className={styles.heading}>
      <h2 id="templates-title">Or start from a template</h2>
      <button ref={headerAction} type="button" aria-expanded={filtersOpen} aria-controls="template-filters" onClick={useHeaderAction}>
        {filtersOpen ? "Browse all" : "Show filters"}
      </button>
    </div>
    <div className={styles.filterShell} data-open={filtersOpen} aria-hidden={!filtersOpen}>
      <div className={styles.filterClip}>
        <FilterRow filter={filter} count={selectedTemplates.length} open={filtersOpen} onSelect={changeFilter} onClose={closeFilters} />
      </div>
    </div>
    <div id="template-grid" className={styles.grid} style={gridStyle} role="tabpanel" aria-labelledby={`template-filter-${filter}`}>
      {visibleTemplates.map(template => <TemplateCard
        key={template.id}
        template={template}
        disabled={disabled}
        leaving={leavingIds.has(template.id)}
        entering={enteringIds.has(template.id)}
        onSelect={onSelect}
      />)}
    </div>
  </section>;
}
