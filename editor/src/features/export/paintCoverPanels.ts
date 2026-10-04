import { LOOK_SIZES } from "../../../../packages/pvo-component-runtime/index.js";
import type { PvoComponent } from "../../domain/project/model";
import {
  COLOR,
  font,
  wrap,
  linesWidth,
  text,
  panel,
  button,
  type Box,
  type Look,
  type Typography,
} from "./coverComponentDrawing";

export function tooltip(
  ctx: CanvasRenderingContext2D,
  component: PvoComponent,
  look: Look | null,
  unit: number,
  typography: Typography,
): Box {
  const bodySize = look ? LOOK_SIZES.body[look.body.size] : 10.5;
  const bodyWeight = look?.body.weight ?? 700;
  const border = look ? 2 : 2 / unit;
  const padX = look ? 12 : 10,
    padY = look ? 12 : 6;
  const dot = look ? 0 : 7,
    gap = look ? 0 : 6;
  font(ctx, bodySize, bodyWeight, typography.body);
  const lines = wrap(
    ctx,
    component.fields.text || "Tap to learn more",
    216 - 2 * (padX + border) - dot - gap,
  );
  const bodyWidth = linesWidth(ctx, lines),
    bodyHeight = lines.length * bodySize * (look ? 1.4 : 1.25);
  const width = Math.min(
    216,
    Math.max(2 * (padX + border) + dot + gap + bodyWidth, 36),
  );
  const height = 2 * (padY + border) + Math.max(dot, bodyHeight);
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
        look?.whole.bg ?? COLOR.light,
        look?.whole.border ?? COLOR.black,
        look?.whole.radius ?? 9,
        border,
        look ? 0 : 2 / unit,
      );
      const contentY = (height - bodyHeight) / 2;
      if (!look) {
        panel(
          painter,
          padX + border,
          (height - dot) / 2,
          dot,
          dot,
          COLOR.violet,
          COLOR.black,
          dot / 2,
          1.5 / unit,
        );
      }
      text(
        painter,
        lines,
        padX + border + dot + gap,
        contentY,
        width - 2 * (padX + border) - dot - gap,
        bodySize,
        bodySize * (look ? 1.4 : 1.25),
        look?.body.color ?? COLOR.ink,
        look?.body.align ?? "left",
        bodyWeight,
        typography.body,
      );
    },
  };
}

export function card(
  ctx: CanvasRenderingContext2D,
  component: PvoComponent,
  look: Look | null,
  unit: number,
  typography: Typography,
): Box {
  const width = 190,
    pad = 12,
    border = look ? 2 : 2.5 / unit;
  const inner = width - 2 * (pad + border);
  const headingSize = look ? LOOK_SIZES.heading[look.heading.size] : 14;
  const bodySize = look ? LOOK_SIZES.body[look.body.size] : 10.5;
  font(ctx, headingSize, 400, typography.heading);
  const heading = wrap(ctx, component.fields.title || "Title", inner);
  font(ctx, bodySize, look?.body.weight ?? 600, typography.body);
  const body = wrap(ctx, component.fields.body || "Text", inner);
  const headingHeight = heading.length * headingSize * (look ? 1.2 : 1);
  const bodyHeight = body.length * bodySize * (look ? 1.4 : 1.3);
  const buttons = component.fields.buttons?.slice(0, 2) ?? [];
  const buttonHeight = buttons.length
    ? Math.max(
        30,
        ...buttons.map((_, index) => {
          const size = look?.btns[index]?.size;
          return size ? LOOK_SIZES.height[size] : 30;
        }),
      )
    : 0;
  const afterHeading = look ? 8 : 7;
  const afterBody = buttons.length ? (look ? 9 + 8 : 8) : look ? 9 : 7;
  const height =
    2 * (pad + border) +
    headingHeight +
    afterHeading +
    bodyHeight +
    afterBody +
    buttonHeight;
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
      const left = pad + border;
      let y = pad + border;
      text(
        painter,
        heading,
        left,
        y,
        inner,
        headingSize,
        headingSize * (look ? 1.2 : 1),
        look?.heading.color ?? COLOR.light,
        look?.heading.align ?? "left",
        400,
        typography.heading,
      );
      y += headingHeight + afterHeading;
      text(
        painter,
        body,
        left,
        y,
        inner,
        bodySize,
        bodySize * (look ? 1.4 : 1.3),
        look?.body.color ?? "rgba(242,240,233,.7)",
        look?.body.align ?? "left",
        look?.body.weight ?? 600,
        typography.body,
      );
      y += bodyHeight + afterBody;
      const gap = 6;
      const buttonWidth =
        (inner - gap * (buttons.length - 1)) / Math.max(1, buttons.length);
      buttons.forEach((item, index) =>
        button(
          painter,
          left + index * (buttonWidth + gap),
          y,
          buttonWidth,
          buttonHeight,
          item.label || `Button ${index + 1}`,
          look,
          index,
          index ? COLOR.dark : COLOR.light,
          index ? COLOR.light : COLOR.ink,
          8,
          10.5,
          typography.body,
        ),
      );
    },
  };
}

export function choice(
  ctx: CanvasRenderingContext2D,
  component: PvoComponent,
  look: Look | null,
  unit: number,
  typography: Typography,
): Box {
  const width = 176;
  const headingSize = look ? LOOK_SIZES.heading[look.heading.size] : 13;
  font(ctx, headingSize, 400, typography.heading);
  const heading = wrap(
    ctx,
    component.fields.prompt || "Which one?",
    width - (look ? 0 : 24),
  );
  const headingHeight =
    heading.length * headingSize * (look ? 1.2 : 1) +
    (look ? 0 : 12 + (2 * 2.5) / unit);
  const headingWidth = look
    ? width
    : Math.min(width, linesWidth(ctx, heading) + 22 + (2 * 2.5) / unit);
  const buttonHeight = Math.max(
    36,
    ...[0, 1].map((index) =>
      look?.btns[index] ? LOOK_SIZES.height[look.btns[index].size] : 36,
    ),
  );
  const gap = 7;
  const height = headingHeight + (look ? 8 : 0) + gap * 2 + buttonHeight * 2;
  return {
    width,
    height,
    paint(painter) {
      if (!look)
        panel(
          painter,
          (width - headingWidth) / 2,
          0,
          headingWidth,
          headingHeight,
          COLOR.violet,
          COLOR.black,
          10,
          2.5 / unit,
          3 / unit,
        );
      text(
        painter,
        heading,
        (width - headingWidth) / 2,
        look ? 0 : (headingHeight - heading.length * headingSize) / 2,
        headingWidth,
        headingSize,
        headingSize * (look ? 1.2 : 1),
        look?.heading.color ?? COLOR.ink,
        look?.heading.align ?? "center",
        400,
        typography.heading,
      );
      const first = headingHeight + (look ? 8 : 0) + gap;
      for (let index = 0; index < 2; index++)
        button(
          painter,
          0,
          first + index * (buttonHeight + gap),
          width,
          buttonHeight,
          component.fields.options?.[index]?.label ||
            `Option ${String.fromCharCode(65 + index)}`,
          look,
          index,
          COLOR.light,
          COLOR.ink,
          10,
          12,
          typography.body,
          3 / unit,
        );
    },
  };
}
