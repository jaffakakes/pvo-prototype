import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";

type Row = { name: string; by: string; len: string; color: string };

export function SoundPicker({
  rows,
  selected,
  onSelect,
  onAdd,
}: {
  rows: readonly Row[];
  selected: number | null;
  onSelect(index: number): void;
  onAdd?(index: number): void;
}) {
  return (
    <div className={cx("soundList")}>
      {rows.map((row, index) => (
        <div
          className={cx("soundRow")}
          key={row.name}
          data-on={selected === index}
        >
          <button
            className={cx("soundChoice")}
            onClick={() => onSelect(index)}
            aria-label={onAdd ? `Preview ${row.name}` : undefined}
          >
            <i style={{ background: row.color }}>
              <Icon name="music" size={19} />
            </i>
            <span>
              <strong>{row.name}</strong>
              <small>{row.by}</small>
            </span>
            <em>{row.len}</em>
            {!onAdd && selected === index && <Icon name="check" size={19} />}
          </button>
          {onAdd && (
            <button
              className={cx("soundAdd")}
              aria-label={`Add ${row.name}`}
              onClick={() => onAdd(index)}
            >
              <Icon name="plus" size={20} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
