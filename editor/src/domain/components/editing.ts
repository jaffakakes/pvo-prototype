import { total } from "../clips/timing";
import { defaultFields } from "./defaults";
import { editComponentFields } from "./languageEditing";
import { editComponentLook } from "./languageLook";
import { componentScale } from "./scale";
import { componentPixelDimension } from "../../../../packages/pvo-component-runtime/index.js";
import { clampComponentStart } from "./timing";
import { createLook } from "./look";
import { DEFAULT_RESPONSE_POLICY } from "./responsePolicy";
import { constrainOverlayPosition } from "../layers/transform";
import type { ComponentType, PvoComponent, Scene } from "../project/model";

const has = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

export function createDefaultComponent(id: string, type: ComponentType, scene: Scene, at: number): PvoComponent {
  const look = createLook("bold", type === "choice" ? 2 : type === "tooltip" ? 0 : 1);
  if (type === "choice") look.whole = { ...look.whole, bg: "none", border: "none" };
  return {
    id, type, sceneId: scene.id, at: clampComponentStart(at, 3, total(scene.clips)), dur: 3,
    x: 50, y: type === "tooltip" ? 28 : 60, fields: defaultFields(type),
    ...(type === "tooltip" ? {} : { responsePolicy: { ...DEFAULT_RESPONSE_POLICY } }),
    look,
  };
}

/** Content, source synchronization, geometry and timing are shared by all editing entry points. */
export function changeComponent(component: PvoComponent, changes: Partial<PvoComponent>, scene: Scene): PvoComponent {
  const fields = component.type === "choice" && changes.fields ? {
    ...changes.fields,
    options: [0, 1].map(index => changes.fields?.options?.[index] ?? component.fields.options?.[index] ?? {
      label: `Option ${String.fromCharCode(65 + index)}`, outcome: { kind: "continue" as const },
    }),
  } : changes.fields;
  const synchronized = fields && !("code" in changes)
    ? editComponentFields(component, fields)
    : { fields: fields ?? component.fields };
  const appearance = changes.look && !("code" in changes)
    ? editComponentLook({ ...component, ...synchronized }, changes.look)
    : {};
  const position = constrainOverlayPosition({
    x: changes.x === undefined ? component.x : changes.x,
    y: changes.y === undefined ? component.y : changes.y,
  });
  const timingChanged = has(changes, "at") || has(changes, "dur");
  const requestedAt = has(changes, "at") && changes.at !== undefined
    ? changes.at
    : component.at;
  const requestedDuration = has(changes, "dur") && changes.dur !== undefined
    ? changes.dur
    : component.dur;
  const next: PvoComponent = {
    ...component, ...changes, ...synchronized, ...appearance, id: component.id, sceneId: scene.id,
    ...position,
    ...(changes.scale === undefined ? {} : { scale: componentScale(changes.scale) }),
    ...(changes.scaleX === undefined ? {} : { scaleX: componentScale(changes.scaleX) }),
    ...(changes.scaleY === undefined ? {} : { scaleY: componentScale(changes.scaleY) }),
    ...("width" in changes ? { width: componentPixelDimension(changes.width) } : {}),
    ...("height" in changes ? { height: componentPixelDimension(changes.height) } : {}),
    ...(timingChanged ? {
      at: clampComponentStart(requestedAt, requestedDuration, total(scene.clips)),
      dur: requestedDuration,
    } : {}),
  };
  return Object.entries(next).every(([key, value]) => component[key as keyof PvoComponent] === value)
    ? component : next;
}
