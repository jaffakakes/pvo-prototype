import { useRef, useState } from "react";
import {
  DEFAULT_TEXT_STYLE,
  TEXT_FONTS,
  TEXT_PRESETS,
  textStyle,
  type TextStyle,
} from "../../../../packages/pvo-text-runtime/index.js";
import { total } from "../../domain/clips/timing";
import type { TextOverlay } from "../../domain/project/model";
import { textTimingAt } from "../../domain/text/timing";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { LayerPositionControls } from "../overlay-position/LayerPositionControls";
import { beginPlayheadPick } from "../timeline/playheadPick";

export function TextEditor() {
  const s = useCapture();
  const text = s.texts.find((item) => item.id === s.selText);
  const [draftStyle, setDraftStyle] = useState<TextStyle>({
    ...DEFAULT_TEXT_STYLE,
  });
  const [tab, setTab] = useState("Designs");
  const editKey = useRef<string | null>(null);
  const style = text ? textStyle(text) : draftStyle;
  const length = total(s.clips);
  const update = (changes: Partial<TextOverlay>, key?: string) => {
    if (!text) return;
    s.updateText(text.id, changes, !key || editKey.current !== key);
    editKey.current = key ?? null;
  };
  const changeStyle = (changes: Partial<TextStyle>, key?: string) => {
    const next = { ...style, ...changes };
    if (text) update({ style: next }, key);
    else setDraftStyle(next);
  };
  const range = (
    label: string,
    key:
      | "size"
      | "strokeWidth"
      | "spacing"
      | "lineHeight"
      | "rotation"
      | "opacity",
    min: number,
    max: number,
    step = 1,
  ) => (
    <label className={cx("textRange")}>
      <span>
        {label}
        <strong>{style[key]}</strong>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={style[key]}
        onChange={(e) => changeStyle({ [key]: Number(e.target.value) }, key)}
        onPointerUp={() => {
          editKey.current = null;
        }}
      />
    </label>
  );
  return (
    <div
      className={cx("textEditor")}
      onBlur={() => {
        editKey.current = null;
      }}
    >
      <div className={cx("textEntry")}>
        <textarea
          aria-label="Text content"
          value={text?.text ?? s.draft}
          maxLength={500}
          rows={2}
          placeholder="Type your text…"
          onChange={(e) =>
            text
              ? update({ text: e.target.value }, "content")
              : s.patch({ draft: e.target.value })
          }
        />
        <button
          className={cx("press")}
          disabled={!(text?.text ?? s.draft).trim()}
          onClick={() => {
            if (!text) {
              s.addText(s.draft.trim(), draftStyle);
              s.patch({ draft: "" });
            }
            s.patch({ sheet: null });
          }}
        >
          {text ? "Done" : "Add"}
        </button>
      </div>
      <div className={cx("textTabs")} role="tablist" aria-label="Text controls">
        {["Designs", "Style", "Timing"].map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className={cx("textControls")} role="tabpanel" aria-label={tab}>
        {tab === "Designs" && (
          <>
            <div className={cx("textPresets")}>
              {TEXT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  aria-label={`Apply ${preset.name} design`}
                  onClick={() => changeStyle(preset.style)}
                >
                  <span
                    style={{
                      fontFamily: TEXT_FONTS[preset.style.font],
                      fontStyle: preset.style.italic ? "italic" : "normal",
                      fontWeight: preset.style.bold ? 700 : 400,
                      color: preset.style.fill,
                      background: preset.style.background,
                      WebkitTextStroke: preset.style.strokeWidth
                        ? ".6px #000"
                        : undefined,
                      textShadow: preset.style.shadow
                        ? "1px 2px 2px #000"
                        : "none",
                    }}
                  >
                    {preset.sample}
                  </span>
                  <small>{preset.name}</small>
                </button>
              ))}
            </div>
            <p className={cx("textHelp")}>
              Start with a design, then make it yours in Style.
            </p>
          </>
        )}
        {tab === "Style" && (
          <div className={cx("textStyleControls")}>
            {text && <div className={cx("textPosition")}>
              <LayerPositionControls key={text.id} target={{ kind: "text", id: text.id }} x={text.x} y={text.y} />
            </div>}
            <label className={cx("textField")}>
              Font
              <select
                aria-label="Text font"
                value={style.font}
                onChange={(e) =>
                  changeStyle({ font: e.target.value as TextStyle["font"] })
                }
              >
                {Object.entries({
                  sans: "Open Sauce",
                  display: "Peace Sans",
                  serif: "Georgia",
                  mono: "Typewriter",
                  condensed: "Impact",
                }).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className={cx("textToggles")}>
              {(["bold", "italic", "underline"] as const).map((key) => (
                <button
                  key={key}
                  aria-label={key}
                  aria-pressed={style[key]}
                  onClick={() => changeStyle({ [key]: !style[key] })}
                >
                  {key === "bold" ? (
                    <b>B</b>
                  ) : key === "italic" ? (
                    <i>I</i>
                  ) : (
                    <u>U</u>
                  )}
                </button>
              ))}
              {(["left", "center", "right"] as const).map((align) => (
                <button
                  key={align}
                  aria-label={`Align ${align}`}
                  aria-pressed={style.align === align}
                  onClick={() => changeStyle({ align })}
                >
                  {align}
                </button>
              ))}
            </div>
            {range("Font size", "size", 8, 64)}
            <div className={cx("textColors")}>
              <label>
                Text colour
                <input
                  type="color"
                  aria-label="Text colour"
                  value={style.fill}
                  onChange={(e) =>
                    changeStyle({ fill: e.target.value }, "fill")
                  }
                />
              </label>
              <label>
                Outline colour
                <input
                  type="color"
                  aria-label="Outline colour"
                  value={style.stroke}
                  onChange={(e) =>
                    changeStyle({ stroke: e.target.value }, "stroke")
                  }
                />
              </label>
              <label>
                Background
                <input
                  type="color"
                  aria-label="Background colour"
                  value={
                    style.background === "transparent"
                      ? "#111117"
                      : style.background
                  }
                  onChange={(e) =>
                    changeStyle({ background: e.target.value }, "background")
                  }
                />
              </label>
            </div>
            <div className={cx("textToggles")}>
              <button
                aria-pressed={style.background !== "transparent"}
                onClick={() =>
                  changeStyle({
                    background:
                      style.background === "transparent"
                        ? "#111117"
                        : "transparent",
                    box: false,
                  })
                }
              >
                Background
              </button>
              <button
                aria-pressed={style.shadow}
                onClick={() => changeStyle({ shadow: !style.shadow })}
              >
                Shadow
              </button>
              <button
                aria-pressed={style.box}
                onClick={() =>
                  changeStyle({
                    box: !style.box,
                    ...(!style.box && style.background === "transparent"
                      ? { background: "#FFD23E", fill: "#111111" }
                      : {}),
                  })
                }
              >
                Label border
              </button>
            </div>
            {range("Outline width", "strokeWidth", 0, 5, 0.1)}
            {range("Letter spacing", "spacing", -1, 6, 0.1)}
            {range("Line spacing", "lineHeight", 0.8, 2, 0.1)}
            {range("Rotation", "rotation", -180, 180)}
            {range("Opacity", "opacity", 0, 1, 0.05)}
          </div>
        )}
        {tab === "Timing" &&
          (text ? (
            <div className={cx("textStyleControls")}>
              <p className={cx("textHelp")}>
                Drag the text bar to move it. Drag either edge to trim.
              </p>
              <div className={cx("textTiming")}>
                <label>
                  Start (s)
                  <input
                    aria-label="Text start"
                    type="number"
                    min={0}
                    max={text.end - 0.1}
                    step={0.1}
                    value={Number(text.start.toFixed(2))}
                    onChange={(e) =>
                      update(
                        textTimingAt(
                          text,
                          "start",
                          Number(e.target.value),
                          length,
                        ),
                        "start",
                      )
                    }
                  />
                </label>
                <label>
                  End (s)
                  <input
                    aria-label="Text end"
                    type="number"
                    min={text.start + 0.1}
                    max={length}
                    step={0.1}
                    value={Number(text.end.toFixed(2))}
                    onChange={(e) =>
                      update(
                        textTimingAt(
                          text,
                          "end",
                          Number(e.target.value),
                          length,
                        ),
                        "end",
                      )
                    }
                  />
                </label>
              </div>
              <button
                className={cx("textAction")}
                onClick={() =>
                  beginPlayheadPick({ kind: "text-start", textId: text.id })
                }
              >
                Use playhead
              </button>
              <button
                className={cx("textAction")}
                onClick={() => update({ start: 0, end: length })}
              >
                Show for whole video
              </button>
            </div>
          ) : (
            <p className={cx("textHelp")}>
              New text starts at the playhead and lasts up to 3 seconds. Add it
              to edit its timing.
            </p>
          ))}
      </div>
      {text && (
        <div className={cx("textFooter")}>
          <button
            onClick={() => {
              s.patch({ selText: null, draft: "" });
              setDraftStyle({ ...DEFAULT_TEXT_STYLE });
            }}
          >
            ＋ New text
          </button>
          <button onClick={() => s.duplicateText(text.id)}>Duplicate</button>
          <button onClick={() => s.deleteText(text.id)}>Delete</button>
        </div>
      )}
    </div>
  );
}
