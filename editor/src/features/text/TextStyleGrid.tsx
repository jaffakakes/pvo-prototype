import {
  TEXT_FONTS,
  TEXT_PRESETS,
  type TextStyle,
} from "../../../../packages/pvo-text-runtime/index.js";
import { cx } from "../../styles";

export function TextStyleGrid({
  style,
  onChange,
}: {
  style: TextStyle;
  onChange(changes: Partial<TextStyle>): void;
}) {
  return (
    <>
      <div className={cx("textCategories")}>Basic</div>
      <div className={cx("textPresets")} role="group" aria-label="Text styles">
        {TEXT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-label={`Apply ${preset.name} style`}
            aria-pressed={
              !style.fontAsset &&
              (Object.keys(preset.style) as (keyof TextStyle)[]).every(
                (key) => style[key] === preset.style[key],
              )
            }
            onClick={() => onChange({ ...preset.style, fontAsset: undefined })}
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
                textShadow: preset.style.shadow ? "1px 2px 2px #000" : "none",
              }}
            >
              {preset.sample}
            </span>
            <small>{preset.name}</small>
          </button>
        ))}
      </div>
    </>
  );
}
