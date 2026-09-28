import { componentEnd } from "../../domain/components/timing";
import type { ComponentType } from "../../domain/project/model";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { componentLabel } from "../preview/ComponentOverlay";
import { SheetFrame } from "./SheetFrame";
import { TYPES } from "./catalog";

export function Picker() {
  const s = useCapture();
  const add = (type: ComponentType) => {
    if (!s.clips.length) return;
    s.addComponent(type);
  };
  return <SheetFrame title="Add a component" sub={`Lands at ${fmt(s.t)}`}>
    <div className={cx("componentPicker")}>
      {!s.clips.length && <p className={cx("componentFootnote")}>Add a clip to this scene before adding a component.</p>}
      <div className={cx("componentTypeGrid")}>
      {TYPES.map(item => <button key={item.type} className={cx("componentTypeTile")} disabled={!s.clips.length} onClick={() => add(item.type)}><span className={cx("componentTypeGlyph")}><Icon name={item.type} size={18} /></span><strong>{item.name}</strong><small>{item.sub}</small></button>)}
    </div>
      {!!s.components.length && <><h3 className={cx("componentListTitle")}>In this video · {s.components.length}</h3><div className={cx("componentList")}>{s.components.map(component => <div key={component.id}>
        <span className={cx("componentTypeGlyph")}><Icon name={component.type} size={14} /></span>
        <button onClick={() => s.patch({ selComp: component.id, sel: -1, sheet: "component", playing: false })}><span>{componentLabel(component)}</span><small>{fmt(component.at)}–{fmt(componentEnd(component, s.clips))}</small></button>
        <button onClick={() => s.deleteComponent(component.id)} aria-label={`Delete ${componentLabel(component)}`}><Icon name="delete" size={14} /></button>
      </div>)}</div></>}
    </div>
  </SheetFrame>;
}
