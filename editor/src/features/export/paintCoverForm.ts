import { LOOK_SIZES } from "../../../../packages/pvo-component-runtime/index.js";
import { formFieldControls } from "../../domain/components/forms";
import type { PvoComponent } from "../../domain/project/model";
import {
  COLOR,
  font,
  wrap,
  text,
  panel,
  button,
  type Box,
  type Look,
  type Typography,
} from "./coverComponentDrawing";

/** CSS normal line boxes use font metrics at the rendered size, including pixel rounding. */
function normalLineHeight(
  ctx: CanvasRenderingContext2D,
  size: number,
  weight: number,
  family: string,
  unit: number,
) {
  font(ctx, size * unit, weight, family);
  const metrics = ctx.measureText("M");
  return (
    (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) / unit
  );
}

/** Canvas counterpart of ComponentFieldsView and its form CSS; geometry is checked against the DOM. */
export function form(
  ctx: CanvasRenderingContext2D,
  component: PvoComponent,
  look: Look | null,
  unit: number,
  typography: Typography,
): Box {
  const width = 190,
    pad = 12,
    border = look ? 2 : 2.5 / unit;
  const left = pad + border;
  const inner = width - 2 * left;
  const headingSize = look ? LOOK_SIZES.heading[look.heading.size] : 14;
  const headingLine = headingSize * (look ? 1.2 : 1);
  font(ctx, headingSize, 400, typography.heading);
  const heading = component.fields.heading
    ? wrap(ctx, component.fields.heading, inner)
    : [];
  const headingHeight = heading.length * headingLine;
  // Unstyled labels inherit the editor's 16px body font rather than the scaled input font.
  const labelSize = look ? LOOK_SIZES.body[look.body.size] : 16 / unit;
  const labelWeight = look?.body.weight ?? 400;
  const labelLine = normalLineHeight(
    ctx,
    labelSize,
    labelWeight,
    typography.body,
    unit,
  );
  font(ctx, labelSize, labelWeight, typography.body);
  const controls = formFieldControls(component.fields);
  const collecting = component.fields.formSubmitMode === "collect";
  const replyIndex = collecting
    ? controls.findIndex((control) => control.type === "text")
    : -1;
  let y = left + headingHeight + (look ? (heading.length ? 8 : 0) : 7);
  const fields = controls.map((control, index) => {
    const label = wrap(ctx, control.label, inner);
    const labelY = y;
    const select = control.type === "yesno";
    const textarea = index === replyIndex;
    const size = look
      ? LOOK_SIZES.body[look.body.size]
      : select
        ? labelSize
        : 10;
    const weight = look?.body.weight ?? (select ? labelWeight : 600);
    const line = normalLineHeight(ctx, size, weight, typography.body, unit);
    font(ctx, labelSize, labelWeight, typography.body);
    const margin = select ? 0 : 5;
    const padding = look ? 6 : textarea ? 7 : 0;
    const fieldBorder = look ? 1 : (select ? 1 : 1.5) / unit;
    const minimum = look ? 29 : textarea ? 60 : 30;
    const height = Math.max(
      minimum,
      line * (textarea ? 3 : 1) + 2 * (padding + fieldBorder),
    );
    y += label.length * labelLine + 3 + margin;
    const fieldY = y;
    y += height + margin + (index < controls.length - 1 ? 6 : 0);
    return {
      control,
      label,
      labelY,
      fieldY,
      height,
      size,
      weight,
      line,
      textarea,
      select,
      padding,
      fieldBorder,
    };
  });
  y += look ? 9 : 7;
  font(ctx, 10.5, 600, typography.body);
  const notice = collecting
    ? wrap(ctx, "Your reply is sent to this video’s creator.", inner)
    : [];
  const noticeY = y;
  if (notice.length) y += notice.length * 10.5 * 1.3 + 7;
  y += 5;
  const buttonY = y;
  const buttonHeight = look
    ? Math.max(
        LOOK_SIZES.height[look.btns[0].size],
        LOOK_SIZES.button[look.btns[0].size] * 1.2 + 14,
      )
    : 34;
  const height = y + buttonHeight + left;
  return {
    width,
    height,
    paint(painter) {
      panel(
        painter,
        0,
        0,
        width,
        height,
        look?.whole.bg ?? COLOR.dark,
        look?.whole.border ?? COLOR.black,
        look?.whole.radius ?? 14,
        border,
        look ? 0 : 3 / unit,
      );
      text(
        painter,
        heading,
        left,
        left,
        inner,
        headingSize,
        headingLine,
        look?.heading.color ?? COLOR.light,
        look?.heading.align ?? "left",
        400,
        typography.heading,
      );
      for (const field of fields) {
        text(
          painter,
          field.label,
          left,
          field.labelY,
          inner,
          labelSize,
          labelLine,
          look?.body.color ?? COLOR.light,
          look?.body.align ?? "left",
          labelWeight,
          typography.body,
        );
        panel(
          painter,
          left,
          field.fieldY,
          inner,
          field.height,
          look ? "none" : COLOR.input,
          look?.body.color ?? "#8F8D95",
          look ? Math.min(look.whole.radius, 14) : 7,
          field.fieldBorder,
        );
        const paddingX = look ? 6 : field.select ? 0 : 8;
        const textY = field.textarea
          ? field.fieldY + field.padding + field.fieldBorder
          : field.fieldY + (field.height - field.line) / 2;
        text(
          painter,
          [field.select ? "No" : field.control.label],
          left + paddingX,
          textY,
          inner - paddingX * 2,
          field.size,
          field.line,
          look?.body.color ?? COLOR.light,
          look?.body.align ?? "left",
          field.weight,
          typography.body,
        );
      }
      painter.save();
      painter.globalAlpha *= 0.8;
      text(
        painter,
        notice,
        left,
        noticeY,
        inner,
        10.5,
        10.5 * 1.3,
        "rgba(242,240,233,.7)",
        look?.whole.align ?? "left",
        600,
        typography.body,
      );
      painter.restore();
      button(
        painter,
        left,
        buttonY,
        inner,
        buttonHeight,
        component.fields.submitLabel || "Send",
        look,
        0,
        COLOR.accent,
        COLOR.light,
        8,
        10.5,
        typography.body,
      );
    },
  };
}
