import type { Ratio } from "../domain/project/model";
import { RATIOS } from "../domain/project/ratio";
import { useCapture } from "../state/captureStore";
import { cx } from "../styles";
import { Icon } from "./Icon";

export function RatioMenu({ place }: { place: "rail" | "tools" }) {
  const s = useCapture();
  if (!s.ratioMenu) return null;
  const pick = (ratio: Ratio) => {
    if (s.ratio !== ratio) s.edit({ ratio, ratioMenu: false });
    else s.patch({ ratioMenu: false });
  };
  const options = [s.ratio, ...(Object.keys(RATIOS) as Ratio[]).filter(ratio => ratio !== s.ratio)];
  return <>
    <button className={cx("menuScrim")} onClick={() => s.patch({ ratioMenu: false })} aria-label="Close ratio menu" />
    <div className={cx(place === "rail" ? "ratioMenu fromRail" : "ratioMenu fromTools")} role="menu" aria-label="Aspect ratio">
      {options.map(ratio => <button key={ratio} role="menuitemradio" aria-checked={s.ratio === ratio} data-on={s.ratio === ratio} onClick={() => pick(ratio)}>
        <i data-ratio={ratio} />
        <span>{ratio}</span>
        {s.ratio === ratio && <Icon name="check" size={13} />}
      </button>)}
    </div>
  </>;
}
