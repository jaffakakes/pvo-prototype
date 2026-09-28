import { dur } from "../../domain/clips/timing";
import { useCapture } from "../../state/captureStore";
import { setSelectedClipSpeed } from "../../state/editing/clipAdjustmentCommands";
import { cx } from "../../styles";
import { Shell } from "../../ui/SheetShell";

export function SpeedSheet() {
  const state = useCapture();
  const clip = state.clips[state.sel];
  const subtitle = clip
    ? `Clip ${state.sel + 1} · ${dur(clip).toFixed(1)}s`
    : "";
  return (
    <Shell title="Speed" sub={subtitle}>
      <div className={cx("speedGrid")}>
        {[0.5, 1, 1.5, 2, 3].map((speed) => (
          <button
            key={speed}
            className={cx("sheetPill")}
            data-on={clip?.speed === speed}
            onClick={() => setSelectedClipSpeed(speed)}
          >
            {speed}x
          </button>
        ))}
      </div>
    </Shell>
  );
}
