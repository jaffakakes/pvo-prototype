import { useState } from "react";
import { applyComponentPreset, LOOK_PRESETS, lookParts, lookPresetName, resetComponentLook, type ComponentLook, type LookAlign, type LookPart, type LookPreset, type LookRadius, type LookSize, type LookWeight } from "../../../domain/components/look";
import { componentLookCustomValues, editComponentLook, projectComponentLook, type LookValuePath } from "../../../domain/components/languageLook";
import type { PvoComponent } from "../../../domain/project/model";
import { useCapture } from "../../../state/captureStore";
import { selectComponentLookPart, useComponentAuthoring } from "../../../state/components/componentAuthoringStore";
import { ColourControl } from "./ColourControl";
import { LookPreview } from "./LookPreview";
import styles from "./LookTab.module.css";
import { FontPicker } from "../../fonts/FontPicker";

function Choices<T extends string | number>({ label, value, customValue, options, onChange }: {
  label: string; value: T; customValue?: string;
  options: readonly { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return <div className={styles.control}>
    <h4>{label}</h4>
    {customValue && <p data-look-custom-value>Custom · {customValue}</p>}
    <div className={styles.chips}>
      {options.map(option => <button
        type="button"
        key={option.value}
        aria-pressed={!customValue && value === option.value}
        data-on={!customValue && value === option.value}
        onClick={() => onChange(option.value)}
      >{option.label}</button>)}
    </div>
  </div>;
}
const SIZES = ["S", "M", "L", "XL"].map(value => ({ value: value as LookSize, label: value }));
const WEIGHTS = [{ value: 600, label: "Regular" }, { value: 700, label: "Bold" }, { value: 800, label: "Black" }] as const;
const CORNERS = [{ value: 0, label: "Square" }, { value: 6, label: "Soft" }, { value: 14, label: "Round" }, { value: 999, label: "Pill" }] as const;
const ALIGNMENTS = [{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }] as const;

export function LookTab({ component, disabled = false, previewScale }: { component: PvoComponent; disabled?: boolean; previewScale?: number }) {
  const session = useComponentAuthoring();
  const [error, setError] = useState<string | null>(null);
  const parts = lookParts(component);
  const part: LookPart = session.componentId === component.id && parts.some(item => item.id === session.part) ? session.part : "whole";
  const look = projectComponentLook(component);
  const custom = componentLookCustomValues(component);
  const buttonIndex = part.startsWith("button:") ? Number(part.slice(7)) : -1;
  const button = look.btns[buttonIndex];
  const change = (edit: (look: ComponentLook) => void, properties: LookValuePath[], undoable = true) => {
    if (disabled) return;
    const state = useCapture.getState();
    const current = state.components.find(item => item.id === component.id);
    if (!current) return;
    const next = projectComponentLook(current);
    edit(next);
    try {
      state.updateComponent(component.id, editComponentLook(current, next, { properties }), undoable);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't update this appearance.");
    }
  };
  const applyLook = (preset: LookPreset | null) => {
    if (disabled) return;
    const state = useCapture.getState();
    const current = state.components.find(item => item.id === component.id);
    if (!current) return;
    const next = preset ? applyComponentPreset(current, preset) : resetComponentLook(current);
    try {
      state.updateComponent(component.id, editComponentLook(current, next, { replace: true }));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't update this appearance.");
    }
  };
  const sizePath: LookValuePath = button ? `btns.${buttonIndex}.size` : part === "heading" ? "heading.size" : "body.size";
  const weightPath: LookValuePath = button ? `btns.${buttonIndex}.weight` : "body.weight";
  const radiusPath: LookValuePath = button ? `btns.${buttonIndex}.radius` : "whole.radius";
  const alignPath: LookValuePath = part === "whole" ? "whole.align" : part === "heading" ? "heading.align" : "body.align";
  const colors = part === "whole" ? [
    { label: "Background", value: look.whole.bg, none: true, paths: ["whole.bg"], set: (next: ComponentLook, color: string) => { next.whole.bg = color; } },
    { label: "Border", value: look.whole.border, none: true, paths: ["whole.border"], set: (next: ComponentLook, color: string) => { next.whole.border = color; } },
    { label: "Text", value: look.whole.text, paths: ["whole.text", "heading.color", "body.color"], set: (next: ComponentLook, color: string) => { next.whole.text = color; next.heading.color = color; next.body.color = color; } },
  ] : button ? [
    { label: "Fill", value: button.fill, none: true, paths: [`btns.${buttonIndex}.fill`], set: (next: ComponentLook, color: string) => { next.btns[buttonIndex].fill = color; } },
    { label: "Text", value: button.text, paths: [`btns.${buttonIndex}.text`], set: (next: ComponentLook, color: string) => { next.btns[buttonIndex].text = color; } },
    { label: "Border", value: button.border, none: true, paths: [`btns.${buttonIndex}.border`], set: (next: ComponentLook, color: string) => { next.btns[buttonIndex].border = color; } },
  ] : [{ label: "Colour", value: part === "heading" ? look.heading.color : look.body.color, paths: [part === "heading" ? "heading.color" : "body.color"], set: (next: ComponentLook, color: string) => { next[part === "heading" ? "heading" : "body"].color = color; } }];

  const setSize = (value: LookSize) => change(next => {
    if (button) next.btns[buttonIndex].size = value;
    else next[part === "heading" ? "heading" : "body"].size = value;
  }, [sizePath]);
  const setWeight = (value: LookWeight) => change(next => {
    if (button) next.btns[buttonIndex].weight = value;
    else next.body.weight = value;
  }, [weightPath]);
  const setCorners = (value: LookRadius) => change(next => {
    if (button) next.btns[buttonIndex].radius = value;
    else next.whole.radius = value;
  }, [radiusPath]);
  const setAlignment = (value: LookAlign) => change(next => {
    if (part === "whole") {
      next.whole.align = value;
      next.heading.align = value;
      next.body.align = value;
    } else next[part === "heading" ? "heading" : "body"].align = value;
  }, part === "whole" ? ["whole.align", "heading.align", "body.align"] : [alignPath]);

  return <fieldset className={styles.tab} disabled={disabled} data-component-look>
    <legend className={styles.srOnly}>Component appearance</legend>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <FontPicker key={component.id} value={component.font} disabled={disabled}
      onChange={font => useCapture.getState().updateComponent(component.id, { font })} />
    <div className={styles.control}>
      <h3>Looks</h3>
      <div className={styles.presets} data-look-presets>
        {LOOK_PRESETS.map(preset => <button
          type="button"
          key={preset}
          className={styles.preset}
          data-on={look.preset === preset}
          aria-pressed={look.preset === preset}
          onClick={() => applyLook(preset)}
        >
          <LookPreview component={component} preset={preset} scale={previewScale} />
          <span>{lookPresetName(preset)}</span>
        </button>)}
      </div>
    </div>
    <div className={styles.control}>
      <h3>Style which part</h3>
      <p>Or tap it on the video.</p>
      <div className={styles.chips}>
        {parts.map(item => <button
          type="button"
          key={item.id}
          aria-pressed={part === item.id}
          data-on={part === item.id}
          onClick={() => selectComponentLookPart(component.id, item.id)}
        >{item.label}</button>)}
      </div>
    </div>
    <div className={styles.partControls} key={part} data-look-part-controls>
      {colors.map(color => <ColourControl
        key={color.label}
        label={color.label}
        value={color.value}
        customValue={custom[color.paths[0] as LookValuePath]}
        allowNone={color.none}
        onChange={(value, undoable) => change(next => color.set(next, value), color.paths as LookValuePath[], undoable)}
      />)}
      {part !== "whole" && <Choices
        label="Size"
        value={button ? button.size : part === "heading" ? look.heading.size : look.body.size}
        customValue={custom[sizePath]}
        options={SIZES}
        onChange={setSize}
      />}
      {(part === "body" || button) && <Choices<LookWeight>
        label="Weight"
        value={button ? button.weight : look.body.weight}
        customValue={custom[weightPath]}
        options={WEIGHTS}
        onChange={setWeight}
      />}
      {(part === "whole" || button) && <Choices<LookRadius>
        label="Corners"
        value={button ? button.radius : look.whole.radius}
        customValue={custom[radiusPath]}
        options={CORNERS}
        onChange={setCorners}
      />}
      {!button && <Choices<LookAlign>
        label="Alignment"
        value={part === "whole" ? look.whole.align : part === "heading" ? look.heading.align : look.body.align}
        customValue={custom[alignPath]}
        options={ALIGNMENTS}
        onChange={setAlignment}
      />}
    </div>
    <div className={styles.reset}>
      <button type="button" onClick={() => applyLook(null)}>Reset appearance</button>
      <p>Back to the {lookPresetName(look.basePreset)} look · keeps your words.</p>
    </div>
  </fieldset>;
}
