import { total } from "../../../domain/clips/timing";
import { clampComponentStart } from "../../../domain/components/timing";
import type { PvoComponent } from "../../../domain/project/model";
import { useCapture } from "../../../state/captureStore";
import { fmt } from "../../../ui/formatTime";
import { beginPlayheadPick } from "../../timeline/playheadPick";
import styles from "../NoCodeEditor.module.css";

export function TimingControls({ component }: { component: PvoComponent }) {
  const t = useCapture(state => state.t);
  const update = useCapture(state => state.updateComponent);
  const useNow = () => {
    const state = useCapture.getState();
    const at = clampComponentStart(state.t, total(state.clips));
    if (component.at !== at) update(component.id, { at });
  };
  return <section className={`${styles.section} componentTiming`} aria-label="Component timing">
    <h3>Appears at <strong className={styles.time}>{fmt(component.at)}</strong></h3>
    <div className={styles.inlineActions}>
      <button type="button" onClick={() => beginPlayheadPick({ kind: "component-at", componentId: component.id })}>Pick on timeline</button>
      <button type="button" onClick={useNow}>Use {fmt(t)}</button>
    </div>
    <h3>Shows for</h3>
    <div className={styles.chips} aria-label="Shows for">
      {[3, 5, 10, null].map(dur => <button type="button" key={dur ?? "end"}
        aria-pressed={component.dur === dur} onClick={() => { if (component.dur !== dur) update(component.id, { dur }); }}>
        {dur === null ? "Until clip ends" : `${dur}s`}
      </button>)}
    </div>
    {component.type !== "tooltip" && <p className={styles.hint}>Under Action, choose whether a viewer’s response runs its selected action right away or when this layer ends.</p>}
  </section>;
}
