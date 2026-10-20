import type { TextEffect } from "../../domain/text/effects";
import { cx } from "../../styles";

const effects = [
  ["jitter", "Jitter"],
  ["flicker", "Flicker"],
  ["pop", "Pop"],
  ["slideRight", "Slide right"],
  ["fadeIn", "Fade in"],
  ["fadeOut", "Fade out"],
] as const;

export function TextEffectGrid({
  value,
  onChange,
}: {
  value: TextEffect | null;
  onChange(effect: TextEffect): void;
}) {
  return (
    <>
      <div className={cx("textCategories")}>
        <button
          type="button"
          className={cx("textNoEffect")}
          aria-label="Apply None effect"
          aria-pressed={value === "none"}
          onClick={() => onChange("none")}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
        <span>Text</span>
      </div>
      <div className={cx("textPresets")} role="group" aria-label="Text effects">
        {effects.map(([effect, name]) => (
          <button
            key={effect}
            type="button"
            data-text-effect={effect}
            aria-label={`Apply ${name} effect`}
            aria-pressed={value === effect}
            onClick={() => onChange(effect)}
          >
            <span>ABC123</span>
            <small>{name}</small>
          </button>
        ))}
      </div>
    </>
  );
}
