import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";

const colours = [
  ["White", "#ffffff"],
  ["Black", "#000000"],
  ["Red", "#f13c46"],
  ["Orange", "#ff9239"],
  ["Yellow", "#f6d342"],
  ["Green", "#78c454"],
  ["Teal", "#08b4a2"],
  ["Cyan", "#0cabc9"],
  ["Blue", "#3695ee"],
  ["Indigo", "#3046ba"],
  ["Violet", "#7146c7"],
  ["Pink", "#ef74ba"],
] as const;

export function TextColourStrip({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (colour: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className={cx("textColourStrip")}
      onPointerDown={(event) => event.preventDefault()}
    >
      <div className={cx("textSwatches")} role="group" aria-label="Text colour">
        {colours.map(([name, colour]) => (
          <button
            key={name}
            type="button"
            aria-label={name}
            aria-pressed={value.toLowerCase() === colour}
            onClick={() => onChange(colour)}
          >
            <span style={{ backgroundColor: colour }} />
          </button>
        ))}
      </div>
      <button
        type="button"
        className={cx("textColourClose")}
        aria-label="Close colours"
        onClick={onClose}
      >
        <Icon name="close" size={24} />
      </button>
    </div>
  );
}
