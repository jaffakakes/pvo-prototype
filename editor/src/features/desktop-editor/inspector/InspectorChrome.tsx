import { Icon } from "../../../ui/Icon";
import styles from "./Inspector.module.css";

export function InspectorHeader({ title, subtitle, icon, kind, onDeselect, closeLabel }: {
  title: string; subtitle: string; icon: string; kind: "project" | "clip" | "component" | "text" | "music";
  onDeselect?: () => void; closeLabel?: string;
}) {
  return <header className={styles.header}>
    <span className={styles.kindIcon} data-kind={kind}><Icon name={icon} size={17} /></span>
    <div><h2>{title}</h2><p>{subtitle}</p></div>
    {onDeselect && <button className={styles.deselect} type="button" aria-label={closeLabel ?? "Deselect"} title={closeLabel ?? "Deselect · Esc"}
      onClick={onDeselect}><Icon name="close" size={15} /></button>}
  </header>;
}

export function InspectorTabs({ tabs, selected, onSelect }: { tabs: string[]; selected: string; onSelect: (tab: string) => void }) {
  return <div className={styles.tabs} role="tablist" aria-label="Inspector tools">
    {tabs.map(tab => <button type="button" role="tab" key={tab} aria-selected={selected === tab}
      onClick={() => onSelect(tab)}>{tab}</button>)}
  </div>;
}
