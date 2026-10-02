import { previewSound } from "../../infrastructure/audio/sound";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { Shell } from "../../ui/SheetShell";
import { SOUNDS } from "./catalog";
import { AnimateEntry } from "../animation/AnimateEntry";

function selectSound(index: number) {
  const state = useCapture.getState();
  if (state.sound !== index) state.edit({ sound: index });
  previewSound(index);
}

export function SoundSheet() {
  const soundIndex = useCapture((state) => state.sound);
  return (
    <Shell title="Sound" sub="Pick a track for this video" actions={soundIndex > 0 ? <AnimateEntry music /> : undefined}>
      <div className={cx("soundList")}>
        {SOUNDS.map((sound, index) => (
          <button
            key={sound.name}
            data-on={soundIndex === index}
            onClick={() => selectSound(index)}
          >
            <i style={{ background: sound.color }}>
              <Icon name="music" size={16} />
            </i>
            <span>
              <strong>{sound.name}</strong>
              <small>{sound.by}</small>
            </span>
            <em>{sound.len}</em>
            {soundIndex === index && (
              <b>
                <Icon name="check" size={15} />
              </b>
            )}
          </button>
        ))}
      </div>
    </Shell>
  );
}
