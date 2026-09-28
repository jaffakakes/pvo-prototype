import type { usePanelResize } from "./usePanelResize";
import styles from "./EditorWorkspace.module.css";

type Props = {
  label: string;
  instructions: string;
  active: boolean;
  maximum: number;
  minimum?: number;
  resize: ReturnType<typeof usePanelResize>;
};

export function PanelResizeHandle({ label, instructions, active, maximum, minimum = 0, resize }: Props) {
  return <div className={styles.resizeHandle} role="separator" tabIndex={active ? 0 : -1}
    aria-label={label} aria-orientation="horizontal"
    aria-valuemin={Math.round(minimum)} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(resize.height)}
    aria-valuetext={`${Math.round(resize.height)} pixels. ${instructions}`}
    title={instructions} {...resize.handleProps}>
    <span />
  </div>;
}
