import {
  TEXT_FONTS,
  type TextStyle,
} from "../../../../packages/pvo-text-runtime/index.js";
import { cx } from "../../styles";
import { FontPicker } from "../fonts/FontPicker";

const fonts = [
  ["sans", "Open Sauce"],
  ["display", "Peace Sans"],
  ["serif", "Georgia"],
  ["mono", "Typewriter"],
  ["condensed", "Impact"],
] as const;

export function TextFontGrid({
  style,
  onChange,
}: {
  style: TextStyle;
  onChange(changes: Partial<TextStyle>): void;
}) {
  return (
    <>
      <div className={cx("textCategories")}>Basic</div>
      <div className={cx("textPresets")} role="group" aria-label="Text fonts">
        {fonts.map(([font, name]) => (
          <button
            key={font}
            type="button"
            aria-label={`Use ${name} font`}
            aria-pressed={!style.fontAsset && style.font === font}
            onClick={() => onChange({ font, fontAsset: undefined })}
          >
            <span style={{ fontFamily: TEXT_FONTS[font] }}>{name}</span>
          </button>
        ))}
        <FontPicker
          tile
          value={style.fontAsset}
          onChange={(fontAsset) => onChange({ fontAsset })}
        />
      </div>
    </>
  );
}
