import type { ReactNode } from "react";
import { Icon } from "../../../ui/Icon";
import styles from "./Library.module.css";

export function LibraryHeading({ children, count }: { children: ReactNode; count?: string }) {
  return <div className={styles.heading}><h2>{children}</h2>{count && <span>{count}</span>}</div>;
}

export function LibrarySearch({ section, query, onChange }: { section: string; query: string; onChange(value: string): void }) {
  return <label className={styles.search}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
    <input aria-label={`Search ${section}`} placeholder={`Search ${section}`} value={query} onChange={event => onChange(event.target.value)} />
  </label>;
}

export function AddBadge() {
  return <span className={styles.addBadge} aria-hidden="true"><Icon name="plus" size={11} strokeWidth={3.4} /></span>;
}

export function LibraryNotice({ children }: { children: ReactNode }) {
  return <p className={styles.notice}>{children}</p>;
}
