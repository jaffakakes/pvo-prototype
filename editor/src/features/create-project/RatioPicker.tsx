import type { Ratio } from "../../domain/project/model";
import { RATIO_HINTS } from "../../domain/project/creation";
import styles from "./CreateProject.module.css";

type Props = { value: Ratio; onChange(value: Ratio): void; disabled?: boolean; compact?: boolean };

export function RatioPicker({ value, onChange, disabled, compact = false }: Props) {
  return <fieldset className={styles.ratioPicker} disabled={disabled} data-compact={compact}>
    <legend>Aspect ratio</legend>
    <div className={styles.ratios}>
      {(Object.keys(RATIO_HINTS) as Ratio[]).map(ratio => <label key={ratio} data-selected={ratio === value}>
        <input type="radio" name="project-ratio" value={ratio} checked={ratio === value} onChange={() => onChange(ratio)} />
        <i data-ratio={ratio} aria-hidden="true" />
        <span>{ratio}</span>
      </label>)}
    </div>
    <p className={styles.hint}>{RATIO_HINTS[value]}</p>
  </fieldset>;
}
