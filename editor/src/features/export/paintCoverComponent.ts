import { evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import { fontFamily } from "../../../../packages/pvo-fonts/index.js";
import {
  componentPixelSize,
  normalizeLook,
} from "../../../../packages/pvo-component-runtime/index.js";
import { componentButtonCount } from "../../domain/components/look";
import type { PvoComponent } from "../../domain/project/model";
import { tooltip, card, choice } from "./paintCoverPanels";
import { form } from "./paintCoverForm";

const DISPLAY = '"Peace Sans", "Arial Black", sans-serif';
const UI = '"Open Sauce Sans", system-ui, sans-serif';

/** Paint a visual PVO component from its authored fields. Code-owned iframe content has no Canvas painter. */
export function paintCoverComponent(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  component: PvoComponent,
  time: number,
): void {
  if (component.code?.custom) return;
  const unit = width / 247;
  const motion = evaluateAnimation(component.animation, time - component.at);
  const family = component.font ? `"${fontFamily(component.font)}"` : null;
  const typography = { heading: family ?? DISPLAY, body: family ?? UI };
  const look = component.look
    ? normalizeLook(component.look, componentButtonCount(component))
    : null;
  const box =
    component.type === "tooltip"
      ? tooltip(ctx, component, look, unit, typography)
      : component.type === "card"
        ? card(ctx, component, look, unit, typography)
        : component.type === "choice"
          ? choice(ctx, component, look, unit, typography)
          : form(ctx, component, look, unit, typography);
  const desired = componentPixelSize(component, {
    width: box.width * unit,
    height: box.height * unit,
  });
  // Composite once: DOM layer opacity applies to the complete card, not each overlapping shape.
  const padding = 8;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((box.width + padding * 2) * unit);
  canvas.height = Math.ceil((box.height + padding * 2) * unit);
  const layer = canvas.getContext("2d");
  if (!layer)
    throw new Error(`Could not draw cover component ${component.id}.`);
  layer.scale(unit, unit);
  layer.translate(padding, padding);
  box.paint(layer);
  ctx.save();
  ctx.globalAlpha = motion.opacity;
  ctx.translate(
    (width * (component.x + motion.x)) / 100,
    (height * (component.y + motion.y)) / 100,
  );
  ctx.rotate((motion.rotation * Math.PI) / 180);
  ctx.scale(
    (desired.width / (box.width * unit)) * motion.scaleX,
    (desired.height / (box.height * unit)) * motion.scaleY,
  );
  ctx.drawImage(
    canvas,
    -(box.width / 2 + padding) * unit,
    -(box.height / 2 + padding) * unit,
  );
  ctx.restore();
}
