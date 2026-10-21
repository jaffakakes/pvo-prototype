import { defaultFields } from "../../domain/components/defaults";
import { createLook } from "../../domain/components/look";
import type { ComponentType } from "../../domain/project/model";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { fmt } from "../../ui/formatTime";
import { SheetFrame } from "./SheetFrame";
import { TYPES } from "./catalog";

function TypePreview({ type }: { type: ComponentType }) {
  const fields = defaultFields(type);
  const buttons =
    fields.options ??
    fields.buttons ??
    (type === "form" ? [{ label: fields.submitLabel }] : []);
  const look = createLook("bold", buttons.length);
  const heading = fields.prompt ?? fields.heading ?? fields.title;
  return (
    <span
      className={cx("componentTypePreview")}
      data-type={type}
      aria-hidden="true"
    >
      <span
        className={cx("componentPreviewPanel")}
        style={{
          background: look.whole.bg,
          color: look.whole.text,
          borderColor: look.whole.border,
        }}
      >
        {heading && (
          <span className={cx("componentPreviewHeading")}>{heading}</span>
        )}
        {(fields.text || fields.body) && (
          <span className={cx("componentPreviewBody")}>
            {fields.text ?? fields.body}
          </span>
        )}
        {fields.formFields?.map((_, index) => (
          <span key={index} className={cx("componentPreviewField")} />
        ))}
        {buttons.length > 0 && (
          <span className={cx("componentPreviewButtons")}>
            {buttons.map((button, index) => (
              <span
                key={index}
                style={{
                  background: look.btns[index].fill,
                  color: look.btns[index].text,
                  borderColor: look.btns[index].border,
                }}
              >
                {button.label}
              </span>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

export function Picker() {
  const s = useCapture();
  const add = (type: ComponentType) => {
    if (!s.clips.length) return;
    s.addComponent(type);
  };
  return (
    <SheetFrame title="Add a component" sub={`Lands at ${fmt(s.t)}`}>
      <div className={cx("componentPicker")}>
        {!s.clips.length && (
          <p className={cx("componentFootnote")}>
            Add a clip to this scene before adding a component.
          </p>
        )}
        <div className={cx("componentTypeGrid")}>
          {TYPES.map((item) => (
            <button
              type="button"
              key={item.type}
              className={cx("componentTypeTile")}
              disabled={!s.clips.length}
              onClick={() => add(item.type)}
            >
              <TypePreview type={item.type} />
              <strong>{item.name}</strong>
            </button>
          ))}
        </div>
      </div>
    </SheetFrame>
  );
}
