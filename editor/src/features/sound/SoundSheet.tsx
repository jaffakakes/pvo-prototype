import { useState } from "react";
import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../../state/captureStore";
import { setLibraryMusic } from "../../state/editing/libraryCommands";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { Shell } from "../../ui/SheetShell";
import { SOUNDS } from "./catalog";
import { SoundBrowser } from "./SoundBrowser";
import { useMusicPreview } from "./useMusicPreview";
import styles from "./SoundBrowser.module.css";

const sounds = SOUNDS.slice(1).map((sound, index) => ({
  ...sound,
  id: String(index + 1),
}));

export function SoundSheet() {
  const soundIndex = useCapture((state) => state.music?.track ?? 0);
  const duration = useCapture((state) => sceneDuration(state));
  const [title] = useState(() =>
    soundIndex > 0 ? "Replace sound" : "Add sound",
  );
  const preview = useMusicPreview();
  const useOriginal = () => {
    if (setLibraryMusic(0)) useCapture.getState().patch({ sheet: null });
  };
  return (
    <Shell title={title} headerless>
      <SoundBrowser
        sounds={sounds}
        inUseId={String(soundIndex)}
        preview={{
          ...preview,
          selected: preview.selected === null ? null : String(preview.selected),
          select: (id) => preview.select(Number(id)),
        }}
        onUse={(id) => setLibraryMusic(Number(id))}
        original={
          <div className={styles.row}>
            <button
              type="button"
              className={styles.choice}
              aria-label="Use Original sound"
              onClick={() => useOriginal()}
            >
              <i className={`${styles.art} ${styles.original}`}>
                <Icon name="edit" size={22} />
              </i>
              <span className={styles.info}>
                <strong>Original sound</strong>
                <small>From your clips · {fmt(duration)}</small>
              </span>
            </button>
            {soundIndex === 0 ? (
              <span className={styles.inUse}>
                <Icon name="check" size={15} />
                In use
              </span>
            ) : (
              <button
                className={styles.use}
                type="button"
                onClick={() => useOriginal()}
                aria-label="Use original clip sound"
              >
                Use
              </button>
            )}
          </div>
        }
      />
    </Shell>
  );
}
