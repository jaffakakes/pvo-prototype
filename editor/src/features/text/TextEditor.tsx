import { useRef, useState } from "react";
import {
  DEFAULT_TEXT_STYLE,
  textStyle,
  type TextStyle,
} from "../../../../packages/pvo-text-runtime/index.js";
import type { TextOverlay } from "../../domain/project/model";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { TextColourStrip } from "./TextColourStrip";
import { TextToolIcon } from "./TextToolIcon";
import { TextFontGrid } from "./TextFontGrid";
import { TextStyleGrid } from "./TextStyleGrid";
import { TextEffectGrid } from "./TextEffectGrid";
import {
  matchingTextEffect,
  textEffectAnimation,
  type TextEffect,
} from "../../domain/text/effects";

export function TextEditor() {
  const s = useCapture();
  const text = s.texts.find((item) => item.id === s.selText);
  const [draftStyle, setDraftStyle] = useState<TextStyle>({
    ...DEFAULT_TEXT_STYLE,
  });
  const [tool, setTool] = useState("font");
  const [draftEffect, setDraftEffect] = useState<TextEffect>("none");
  const [inputFocused, setInputFocused] = useState(true);
  const editKey = useRef<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
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
  return (
    <div
      className={cx("textEditor")}
      data-input-focused={inputFocused}
      onBlur={() => {
        editKey.current = null;
      }}
    >
      {tool === "colour" && (
        <TextColourStrip
          value={style.fill}
          onChange={(fill) => changeStyle({ fill })}
          onClose={() => setTool("font")}
        />
      )}
      <div className={cx("textEntry")}>
        <textarea
          ref={input}
          autoFocus
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
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
        {inputFocused ? (
          <button
            type="button"
            className={cx("textConfirm")}
            aria-label="Hide keyboard"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              input.current?.blur();
              setInputFocused(false);
            }}
          >
            <TextToolIcon name="keyboard" />
          </button>
        ) : (
          <button
            type="button"
            className={cx("textConfirm")}
            aria-label="Done"
            onClick={() => {
              if (!text && s.draft.trim()) {
                const id = s.addText(s.draft.trim(), draftStyle);
                if (draftEffect !== "none") {
                  const current = useCapture.getState();
                  const added = current.texts.find((item) => item.id === id)!;
                  current.updateText(
                    id,
                    {
                      animation: textEffectAnimation(
                        draftEffect,
                        added.end - added.start,
                      ),
                    },
                    false,
                  );
                }
                s.patch({ draft: "" });
              }
              s.patch({ sheet: null });
            }}
          >
            <Icon name="check" size={26} />
          </button>
        )}
      </div>
      <div
        className={cx("textTools")}
        role="toolbar"
        aria-label="Text tools"
        onPointerDown={(event) => event.preventDefault()}
      >
        <button
          type="button"
          aria-label="Text fonts"
          aria-pressed={tool === "font"}
          onClick={() => {
            input.current?.blur();
            setTool("font");
          }}
        >
          <TextToolIcon name="font" />
        </button>
        <button
          type="button"
          aria-label="Text colours"
          aria-pressed={tool === "colour"}
          onClick={() => setTool(tool === "colour" ? "font" : "colour")}
        >
          <span className={cx("textColourWheel")} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Font styles"
          aria-pressed={tool === "style"}
          onClick={() => {
            input.current?.blur();
            setTool("style");
          }}
        >
          <TextToolIcon name="background" />
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
          aria-label="Text effects"
          aria-pressed={tool === "effects"}
          onClick={() => {
            input.current?.blur();
            setTool("effects");
          }}
        >
          <TextToolIcon name="designs" />
        </button>
      </div>
      <div className={cx("textControls")} hidden={inputFocused}>
        {(tool === "font" || tool === "colour") && (
          <TextFontGrid style={style} onChange={changeStyle} />
        )}
        {tool === "style" && (
          <TextStyleGrid style={style} onChange={changeStyle} />
        )}
        {tool === "effects" && (
          <TextEffectGrid
            value={
              text
                ? matchingTextEffect(text.animation, text.end - text.start)
                : draftEffect
            }
            onChange={(effect) => {
              if (text)
                update({
                  animation: textEffectAnimation(effect, text.end - text.start),
                  animationTracking: undefined,
                });
              else setDraftEffect(effect);
            }}
          />
        )}
      </div>
    </div>
  );
}
