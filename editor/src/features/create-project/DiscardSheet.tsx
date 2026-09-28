import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Shell } from "../../ui/SheetShell";

export function DiscardSheet() {
  const state = useCapture();
  return (
    <Shell
      title="Start over?"
      sub={`This removes all ${state.clips.length} clips.`}
    >
      <div className={cx("discardGrid")}>
        <button onClick={() => state.patch({ sheet: null })}>Keep</button>
        <button onClick={() => state.reset()}>Discard</button>
      </div>
    </Shell>
  );
}
