import { useState, type CSSProperties } from "react";
import { exportCoverAt } from "../../domain/project/cover";
import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../../state/captureStore";
import { Icon } from "../../ui/Icon";
import { useCoverPreview } from "../export/useExportPreviewUrls";
import { useEditorTransition } from "../../ui/motion/EditorMotion";
import { CoverPicker } from "./CoverPicker";
import styles from "./CoverButton.module.css";

export function CoverButton({
  style,
  disabled = false,
}: {
  style?: CSSProperties;
  disabled?: boolean;
}) {
  const transition = useEditorTransition();
  const main = useCapture((state) =>
    state.scenes.find((scene) => scene.id === "main"),
  );
  const ratio = useCapture((state) => state.ratio);
  const coverAt = useCapture((state) => state.coverAt);
  const blocked = useCapture(
    (state) =>
      !!state.tryMode || !!state.playheadPick || state.ex === "running",
  );
  const [open, setOpen] = useState(false);
  const available = !!main && sceneDuration(main) > 0;
  const time = main ? exportCoverAt({ scenes: [main], coverAt }) : 0;
  const image = useCoverPreview(main, ratio, time, available);

  return (
    <>
      <button
        type="button"
        className={styles.button}
        style={style}
        aria-label="Edit cover"
        aria-haspopup="dialog"
        data-cover-button
        disabled={disabled || blocked || !available}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          useCapture.getState().patch({ playing: false, orb: false });
          transition("frame", () => setOpen(true));
        }}
      >
        {image && <img src={image} alt="" />}
        <span className={styles.caption}>
          <Icon name="pencil" size={22} />
          <span>Cover</span>
        </span>
      </button>
      {open && main && (
        <CoverPicker
          scene={main}
          ratio={ratio}
          initialTime={time}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
