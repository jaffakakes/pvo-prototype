import { useRef } from "react";
import { total } from "../../../domain/clips/timing";
import { componentEnd } from "../../../domain/components/timing";
import type { PvoComponent } from "../../../domain/project/model";
import { useCapture } from "../../../state/captureStore";
import { pickTime } from "../../../ui/formatTime";
import { FrameFilmstrip } from "../../frame-picker/FrameFilmstrip";
import { beginPlayheadPick } from "../../timeline/playheadPick";
import styles from "../ComponentPage.module.css";

export function ComponentTiming({ component }: { component: PvoComponent }) {
  const scene = useCapture((state) =>
    state.scenes.find((item) => item.id === component.sceneId),
  );
  const update = useCapture((state) => state.updateComponent);
  const edited = useRef(false);
  if (!scene) return null;
  const length = total(scene.clips);
  const end = componentEnd(component, scene.clips);
  return (
    <div className={styles.stack}>
      <h3>
        Appears at <span>{pickTime(component.at)}</span>
      </h3>
      <div
        onPointerDownCapture={() => {
          edited.current = false;
        }}
        onKeyDownCapture={() => {
          edited.current = false;
        }}
      >
        <FrameFilmstrip
          scene={scene}
          time={component.at}
          maximum={Math.max(length, component.at, 0.5)}
          label="Component appears at"
          onTime={(at) => {
            update(component.id, { at }, !edited.current);
            edited.current = true;
          }}
        />
      </div>
      <button
        className={styles.row}
        type="button"
        onClick={() =>
          beginPlayheadPick({ kind: "component-at", componentId: component.id })
        }
      >
        Pick on video
      </button>
      <h3>Shows for</h3>
      <div className={styles.parts}>
        {[3, 5, 10, null].map((dur) => (
          <button
            key={dur ?? "end"}
            type="button"
            aria-pressed={component.dur === dur}
            onClick={() => update(component.id, { dur })}
          >
            {dur === null ? "Until clip ends" : `${dur} s`}
          </button>
        ))}
      </div>
      {end > length && (
        <p className={styles.hint}>Extends the scene to {pickTime(end)}.</p>
      )}
    </div>
  );
}
