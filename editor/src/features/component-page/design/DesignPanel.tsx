import { useState } from "react";
import {
  designColour,
  solidColour,
  recolourBackground,
  editComponentDesign,
  tintColour,
  type DesignEdit,
} from "../../../domain/components/design";
import {
  componentLook,
  LOOK_PRESETS,
  lookPresetName,
  lookParts,
  type LookPart,
} from "../../../domain/components/look";
import type { PvoComponent } from "../../../domain/project/model";
import { useCapture } from "../../../state/captureStore";
import { ContentTab } from "../../component-authoring/fields/ContentTab";
import { LookPreview } from "../../component-authoring/look/LookPreview";
import { ComponentSizeControls } from "../../component-authoring/size/ComponentSizeControls";
import { LayerPositionControls } from "../../overlay-position/LayerPositionControls";
import { FontPicker } from "../../fonts/FontPicker";
import { Icon } from "../../../ui/Icon";
import styles from "../ComponentPage.module.css";

export type DesignTool =
  | "looks"
  | "background"
  | "border"
  | "text"
  | "corners"
  | "words"
  | "layout"
  | "fields"
  | "code";
export const DESIGN_TITLES: Record<DesignTool, string> = {
  looks: "Looks",
  background: "Background",
  border: "Border",
  text: "Text style",
  corners: "Corners",
  words: "Text",
  layout: "Layout",
  fields: "Fields",
  code: "Code",
};
const COLOURS = [
  "#15151c",
  "#fffdfb",
  "#ff2d78",
  "#a78bfa",
  "#ffd23e",
  "#2ec4b6",
];
const CORNERS = [
  { value: 0, name: "Square" },
  { value: 6, name: "Soft" },
  { value: 14, name: "Round" },
  { value: 22, name: "Rounder" },
  { value: 999, name: "Pill" },
] as const;

export function DesignPanel({
  component,
  part,
  onPart,
  tool,
  blocked,
}: {
  component: PvoComponent;
  part: LookPart;
  onPart(part: LookPart): void;
  tool: DesignTool;
  blocked: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [colours, setColours] = useState<Record<string, string>>({});
  const look = componentLook(component);
  const button = part.startsWith("button:")
    ? look.btns[Number(part.slice(7))]
    : undefined;
  const colourKind =
    tool === "background" || tool === "border" || tool === "text" ? tool : null;
  const colourKey = `${part}:${colourKind}`;
  const rememberedColour = colours[colourKey] ?? "#a78bfa";
  const currentColour = colourKind
    ? designColour(component, part, colourKind)
    : rememberedColour;
  const colour = solidColour(currentColour, rememberedColour);
  const change = (edit: DesignEdit) => {
    const state = useCapture.getState();
    const current = state.components.find((item) => item.id === component.id);
    if (!current || blocked) return;
    try {
      const changes = editComponentDesign(current, part, edit);
      if (changes) state.updateComponent(component.id, changes);
      setError(null);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Couldn't update this appearance.",
      );
    }
  };
  const pickColour = (value: string) => {
    setColours((previous) => ({ ...previous, [colourKey]: value }));
    if (colourKind)
      change({
        kind: colourKind,
        value:
          colourKind === "background"
            ? recolourBackground(currentColour, value)
            : value,
      });
  };
  return (
    <>
      {colourKind && (
        <fieldset
          className={styles.colourbar}
          disabled={blocked}
          aria-label={`${DESIGN_TITLES[tool]} colour`}
        >
          <span>Colour</span>
          {COLOURS.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`Use ${value}`}
              aria-pressed={colour.toLowerCase() === value}
              style={{ background: value }}
              onClick={() => pickColour(value)}
            />
          ))}
          <label className={styles.customColour} title="Custom colour">
            <Icon name="plus" size={16} />
            <input
              type="color"
              aria-label="Custom colour"
              value={
                /^#[\da-f]{6}$/i.test(currentColour) ? currentColour : colour
              }
              onChange={(event) => pickColour(event.target.value)}
            />
          </label>
        </fieldset>
      )}
      <div className={styles.sheetBody}>
        <h2>{DESIGN_TITLES[tool]}</h2>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {!["layout", "fields", "looks"].includes(tool) && (
          <div className={styles.parts} aria-label="Style which part">
            {lookParts(component).map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={part === item.id}
                onClick={() => onPart(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        {tool === "layout" ? (
          <>
            <LayerPositionControls
              target={{ kind: "component", id: component.id }}
              x={component.x}
              y={component.y}
            />
            <ComponentSizeControls component={component} />
          </>
        ) : (
          <fieldset disabled={blocked} className={styles.controls}>
            {tool === "looks" && (
              <>
                {component.code?.custom && (
                  <p className={styles.hint}>
                    Choosing a look replaces your custom Style. Your words and
                    Logic stay as they are.
                  </p>
                )}
                <div className={styles.catalogue}>
                  {LOOK_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      aria-pressed={look.preset === preset}
                      onClick={() => change({ kind: "preset", value: preset })}
                    >
                      <span className={styles.lookDisc}>
                        <LookPreview
                          component={component}
                          preset={preset}
                          scale={0.3}
                        />
                      </span>
                      <span>{lookPresetName(preset)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {tool === "background" && (
              <div className={styles.catalogue}>
                {(
                  [
                    ["solid", "Solid"],
                    ["none", "Transparent"],
                    ["tint", "Tint"],
                  ] as const
                ).map(([kind, label]) => {
                  const value =
                    kind === "none"
                      ? "none"
                      : kind === "tint"
                        ? tintColour(colour)
                        : colour;
                  const selected =
                    kind === "none"
                      ? currentColour === "none"
                      : kind === "tint"
                        ? currentColour.startsWith("rgba")
                        : currentColour !== "none" &&
                          !currentColour.startsWith("rgba");
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setColours((previous) => ({
                          ...previous,
                          [colourKey]: colour,
                        }));
                        change({ kind: "background", value });
                      }}
                    >
                      <span
                        className={styles.disc}
                        style={{
                          background: kind === "none" ? "transparent" : value,
                        }}
                      >
                        <Icon name={kind === "none" ? "close" : "components"} />
                      </span>
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {tool === "border" && (
              <div className={styles.catalogue}>
                {(
                  [
                    ["none", "None"],
                    [colour, "Solid"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={
                      (currentColour === "none") === (value === "none")
                    }
                    onClick={() => {
                      setColours((previous) => ({
                        ...previous,
                        [colourKey]: colour,
                      }));
                      change({ kind: "border", value });
                    }}
                  >
                    <span
                      className={styles.disc}
                      style={{
                        border: value === "none" ? "0" : `3px solid ${value}`,
                      }}
                    >
                      <Icon name={value === "none" ? "close" : "crop"} />
                    </span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
            {tool === "corners" && (
              <div className={styles.catalogue}>
                {CORNERS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={
                      (button?.radius ?? look.whole.radius) === item.value
                    }
                    onClick={() =>
                      change({ kind: "corners", value: item.value })
                    }
                  >
                    <span
                      className={styles.corner}
                      style={{ borderRadius: item.value }}
                    />
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
            )}
            {tool === "words" && (
              <ContentTab
                component={component}
                disabled={blocked}
                section="words"
              />
            )}
            {tool === "fields" && (
              <ContentTab
                component={component}
                disabled={blocked}
                section="fields"
              />
            )}
            {tool === "text" && (
              <>
                <div className={styles.formatRow} aria-label="Text size">
                  {(["S", "M", "L", "XL"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={
                        (button?.size ??
                          look[part === "heading" ? "heading" : "body"]
                            .size) === value
                      }
                      onClick={() => change({ kind: "size", value })}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                {(part === "body" || button) && (
                  <div className={styles.formatRow} aria-label="Text weight">
                    {([600, 700, 800] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={
                          (button?.weight ?? look.body.weight) === value
                        }
                        onClick={() => change({ kind: "weight", value })}
                      >
                        {value === 600
                          ? "Regular"
                          : value === 700
                            ? "Bold"
                            : "Black"}
                      </button>
                    ))}
                  </div>
                )}
                {!button && (
                  <div className={styles.formatRow} aria-label="Text alignment">
                    {(["left", "center", "right"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-label={`Align ${value}`}
                        aria-pressed={
                          look[
                            part === "whole"
                              ? "whole"
                              : part === "heading"
                                ? "heading"
                                : "body"
                          ].align === value
                        }
                        onClick={() => change({ kind: "align", value })}
                      >
                        <Icon
                          name={`align${value[0].toUpperCase()}${value.slice(1)}`}
                        />
                      </button>
                    ))}
                  </div>
                )}
                <FontPicker
                  value={component.font}
                  disabled={blocked}
                  onChange={(font) =>
                    useCapture
                      .getState()
                      .updateComponent(component.id, { font })
                  }
                />
              </>
            )}
          </fieldset>
        )}
      </div>
    </>
  );
}
