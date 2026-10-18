import { useRef } from "react";
import { total } from "../../domain/clips/timing";
import { textTimingAt } from "../../domain/text/timing";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Shell } from "../../ui/SheetShell";
import { beginPlayheadPick } from "../timeline/playheadPick";

export function TextTimingSheet() {
  const s = useCapture();
  const text = s.texts.find((item) => item.id === s.selText);
  const editKey = useRef<string | null>(null);
  if (!text) return null;
  const videoLength = total(s.clips);
  return (
    <Shell
      title="Text timing"
      sub="Drag the text bar or its edges on the timeline"
    >
      <div
        className={cx("textStyleControls")}
        onBlur={() => {
          editKey.current = null;
        }}
      >
        <div className={cx("textTiming")}>
          {(["start", "end"] as const).map((edge) => (
            <label key={edge}>
              {edge === "start" ? "Start (s)" : "End (s)"}
              <input
                type="number"
                aria-label={`Text ${edge}`}
                step={0.1}
                min={edge === "start" ? 0 : text.start + 0.1}
                max={edge === "start" ? text.end - 0.1 : undefined}
                value={Number(text[edge].toFixed(2))}
                onChange={(event) => {
                  s.updateText(
                    text.id,
                    textTimingAt(text, edge, Number(event.target.value)),
                    editKey.current !== edge,
                  );
                  editKey.current = edge;
                }}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          className={cx("textAction")}
          onClick={() =>
            beginPlayheadPick({ kind: "text-start", textId: text.id })
          }
        >
          Use playhead
        </button>
        <button
          type="button"
          className={cx("textAction")}
          disabled={videoLength <= 0}
          onClick={() => {
            editKey.current = null;
            s.updateText(text.id, { start: 0, end: videoLength });
          }}
        >
          Show for whole video
        </button>
      </div>
    </Shell>
  );
}
