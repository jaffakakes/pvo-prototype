import { useRef, useState } from "react";
import {
  DEFAULT_TEXT_STYLE,
  TEXT_FONTS,
  TEXT_PRESETS,
  textStyle,
  type TextStyle,
} from "../../../../packages/pvo-text-runtime/index.js";
import type { TextOverlay } from "../../domain/project/model";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { LayerPositionControls } from "../overlay-position/LayerPositionControls";
import { Icon } from "../../ui/Icon";
import { FontPicker } from "../fonts/FontPicker";

export function TextEditor() {
  const s = useCapture();
  const text = s.texts.find((item) => item.id === s.selText);
  const [draftStyle, setDraftStyle] = useState<TextStyle>({
    ...DEFAULT_TEXT_STYLE,
  });
  const [tool, setTool] = useState("designs");
  const editKey = useRef<string | null>(null);
  const style = text ? textStyle(text) : draftStyle;
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
          rows={1}
          placeholder="Enter text"
          onChange={(e) =>
            text
              ? update({ text: e.target.value }, "content")
              : s.patch({ draft: e.target.value })
          }
        />
        <button
          type="button"
          className={cx("textConfirm")}
          aria-label="Done"
          onClick={() => {
            if (!text && s.draft.trim()) {
              s.addText(s.draft.trim(), draftStyle);
              s.patch({ draft: "" });
            }
            s.patch({ sheet: null });
          }}
        >
          <Icon name="check" size={26} />
        </button>
      </div>
      <div className={cx("textTools")} role="toolbar" aria-label="Text tools">
        <button
          type="button"
          aria-label="Font"
          aria-pressed={tool === "font"}
          onClick={() => setTool("font")}
        >
          <Icon name="text" size={22} />
        </button>
        <button
          type="button"
          aria-label="Text colours"
          aria-pressed={tool === "colour"}
          onClick={() => setTool("colour")}
        >
          <Icon name="palette" size={22} />
        </button>
        <button
          type="button"
          aria-label="Text background"
          aria-pressed={style.background !== "transparent"}
          onClick={() =>
            changeStyle({
              background:
                style.background === "transparent" ? "#111117" : "transparent",
              box: false,
            })
          }
        >
          <Icon name="card" size={22} />
        </button>
        <button
          type="button"
          aria-label="Text alignment"
          title={`Align ${style.align}`}
          onClick={() =>
            changeStyle({
              align:
                style.align === "left"
                  ? "center"
                  : style.align === "center"
                    ? "right"
                    : "left",
            })
          }
        >
          <Icon
            name={
              style.align === "left"
                ? "alignLeft"
                : style.align === "right"
                  ? "alignRight"
                  : "alignCenter"
            }
            size={22}
          />
        </button>
        <button
          type="button"
          aria-label="Text designs"
          aria-pressed={tool === "designs"}
          onClick={() => setTool("designs")}
        >
          <Icon name="textDesigns" size={22} />
        </button>
      </div>
      <div className={cx("textControls")}>
        {tool === "designs" && (
          <>
            <div className={cx("textPresets")}>
              {TEXT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  aria-label={`Apply ${preset.name} design`}
                  aria-pressed={
                    !style.fontAsset &&
                    (Object.keys(preset.style) as (keyof TextStyle)[]).every(
                      (key) => style[key] === preset.style[key],
                    )
                  }
                  onClick={() =>
                    changeStyle({ ...preset.style, fontAsset: undefined })
                  }
                >
                  <span
                    style={{
                      fontFamily: TEXT_FONTS[preset.style.font],
                      fontStyle: preset.style.italic ? "italic" : "normal",
                      fontWeight: preset.style.bold ? 700 : 400,
                      color:
                        preset.style.fill === "#ffffff" &&
                        preset.style.background === "transparent" &&
                        !preset.style.shadow &&
                        !preset.style.strokeWidth
                          ? "var(--text)"
                          : preset.style.fill,
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
          </>
        )}
        {(tool === "font" || tool === "colour") && (
          <div className={cx("textStyleControls")}>
            {tool === "font" && (
              <>
                <FontPicker
                  key={text?.id ?? "draft"}
                  value={style.fontAsset}
                  onChange={(fontAsset) => changeStyle({ fontAsset })}
                />
                {text && (
                  <div className={cx("textPosition")}>
                    <LayerPositionControls
                      key={text.id}
                      target={{ kind: "text", id: text.id }}
                      x={text.x}
                      y={text.y}
                    />
                  </div>
                )}
                <label className={cx("textField")}>
                  Font
                  <select
                    aria-label="Text font"
                    value={style.font}
                    onChange={(e) =>
                      changeStyle({
                        font: e.target.value as TextStyle["font"],
                        fontAsset: undefined,
                      })
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
              </>
            )}
            {tool === "colour" && (
              <>
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
                        changeStyle(
                          { background: e.target.value },
                          "background",
                        )
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
              </>
            )}
            {tool === "font" && (
              <>
                {range("Outline width", "strokeWidth", 0, 5, 0.1)}
                {range("Letter spacing", "spacing", -1, 6, 0.1)}
                {range("Line spacing", "lineHeight", 0.8, 2, 0.1)}
                {range("Rotation", "rotation", -180, 180)}
                {range("Opacity", "opacity", 0, 1, 0.05)}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
