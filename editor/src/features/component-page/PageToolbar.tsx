import { Icon } from "../../ui/Icon";
import styles from "./ComponentPage.module.css";

export type PageTool = {
  id: string;
  label: string;
  icon: string;
  warning?: boolean;
};
export function PageToolbar({
  tools,
  selected,
  onSelect,
  onBack,
}: {
  tools: PageTool[];
  selected: string;
  onSelect(id: string): void;
  onBack?: () => void;
}) {
  return (
    <nav className={styles.toolbar} aria-label="Component tools">
      {onBack && (
        <button
          type="button"
          className={styles.toolBack}
          aria-label="Back to design tools"
          onClick={onBack}
        >
          <Icon name="back" />
        </button>
      )}
      {tools.map((tool) => (
        <button
          type="button"
          key={tool.id}
          aria-pressed={selected === tool.id}
          onClick={() => onSelect(tool.id)}
        >
          <Icon name={tool.icon} />
          <span>
            {tool.label}
            {tool.warning && <i aria-label="Code needs attention" />}
          </span>
        </button>
      ))}
    </nav>
  );
}
