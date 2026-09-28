import { useRef } from "react";
import { useCapture } from "../../state/captureStore";
import { adjustSelectedClip } from "../../state/editing/clipAdjustmentCommands";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { Shell } from "../../ui/SheetShell";

export function CropSheet() {
  const state = useCapture();
  const clip = state.clips[state.sel];
  const hasSnapshot = useRef(false);
  const zoom = (value: number) => {
    if (adjustSelectedClip({ zoom: value }, !hasSnapshot.current))
      hasSnapshot.current = true;
  };
  return (
    <Shell title="Crop" sub={`Clip ${state.sel + 1} · zoom and mirror`}>
      <div className={cx("zoomLabel")}>
        <span>Zoom</span>
        <strong>{Math.round((clip?.zoom ?? 1) * 100)}%</strong>
      </div>
      <input
        className={cx("zoomRange")}
        type="range"
        min="100"
        max="200"
        step="1"
        value={Math.round((clip?.zoom ?? 1) * 100)}
        onChange={(event) => zoom(Number(event.target.value) / 100)}
      />
      <div className={cx("twoGrid")}>
        <button
          className={cx("sheetPill")}
          data-on={!!clip?.mirror}
          onClick={() => adjustSelectedClip({ mirror: !clip?.mirror })}
        >
          <Icon name="mirror" size={17} /> Mirror
        </button>
        <button
          className={cx("sheetPill")}
          onClick={() => adjustSelectedClip({ zoom: 1, mirror: false })}
        >
          Reset
        </button>
      </div>
    </Shell>
  );
}
