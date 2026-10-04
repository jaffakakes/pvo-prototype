import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const font = {
  id: "cover-layout-fixture",
  family: "Cover Layout Fixture",
  sourceUrl: "https://example.com/font",
  licenseUrl: "https://example.com/license",
  licenseText: "Repository font used as an internal test fixture.",
  faces: [
    {
      dataUrl: `data:font/woff2;base64,${readFileSync("editor/src/fonts/peace-sans.woff2").toString("base64")}`,
      weight: "400 800",
      style: "normal",
    },
  ],
};
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", {
    waitUntil: "networkidle",
  });
  const results = await page.evaluate(async (font) => {
    const entry = await (await fetch("/src/main.tsx")).text();
    const dependency = (name) =>
      entry.match(new RegExp(`from "([^"]*/deps/${name}\\.js[^\\"]*)"`))?.[1];
    const React = (await import(dependency("react"))).default;
    const { createRoot } = (await import(dependency("react-dom_client")))
      .default;
    const { ComponentOverlay } =
      await import("/src/features/preview/ComponentOverlay.tsx");
    const { paintCoverComponent } =
      await import("/src/features/export/paintCoverComponent.ts");
    const look = {
      preset: "bold",
      basePreset: "bold",
      whole: {
        bg: "#15151C",
        border: "#000000",
        text: "#F2F0E9",
        radius: 14,
        align: "center",
      },
      heading: { color: "#F2F0E9", size: "L", align: "center" },
      body: { color: "#F2F0E9", size: "M", weight: 600, align: "center" },
      btns: [
        {
          fill: "#FF9FBC",
          text: "#15151C",
          border: "#000000",
          size: "M",
          weight: 800,
          radius: 14,
        },
      ],
    };
    const native = [
      { id: "tooltip", type: "tooltip", fields: { text: "A short note" } },
      {
        id: "card",
        type: "card",
        fields: {
          title: "A card",
          body: "Body copy",
          buttons: [{ label: "Explore" }],
        },
      },
      {
        id: "choice",
        type: "choice",
        fields: {
          prompt: "Pick one",
          options: [{ label: "Alpha" }, { label: "Beta" }],
        },
      },
    ];
    const form = {
      id: "form",
      type: "form",
      fields: {
        heading: "Join us",
        formFields: [{ name: "Email", type: "text" }],
        submitLabel: "Send it",
      },
    };
    const collect = {
      ...form,
      id: "collect",
      fields: {
        ...form.fields,
        formSubmitMode: "collect",
        formFields: [{ name: "Your message", type: "text" }],
      },
    };
    const fixtures = [
      ...native,
      form,
      {
        ...form,
        id: "yesno",
        fields: { formFields: [{ name: "Updates", type: "yesno" }] },
      },
      {
        ...form,
        id: "multiple",
        fields: {
          ...form.fields,
          formFields: [
            { name: "Your full name", type: "text" },
            { name: "Age", type: "number" },
            { name: "Updates", type: "yesno" },
          ],
        },
      },
      collect,
      { ...form, id: "look", look },
      { ...collect, id: "collect-look", look },
      { ...collect, id: "custom-font", font },
    ];
    const settle = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;top:0;left:0;z-index:2147483647;background:transparent";
    document.body.append(host);
    const root = createRoot(host);
    const results = [];
    try {
      for (const width of [247, 494])
        for (const fixture of fixtures) {
          const unit = width / 247,
            height = 440 * unit;
          host.style.width = `${width}px`;
          host.style.height = `${height}px`;
          const component = { at: 0, dur: 4, x: 50, y: 50, ...fixture };
          root.render(
            React.createElement(ComponentOverlay, {
              component,
              width,
              selected: false,
              trying: false,
              time: 1,
              zIndex: 1,
              onResponse() {},
            }),
          );
          await settle();
          await document.fonts.ready;
          await settle();
          const bounds = host.firstElementChild.getBoundingClientRect();
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          // Observe actual canvas paths, so the geometry comparison excludes rasterized border/shadow fringes.
          const paths = [],
            captions = [];
          const originalRect = CanvasRenderingContext2D.prototype.roundRect;
          const originalText = CanvasRenderingContext2D.prototype.fillText;
          CanvasRenderingContext2D.prototype.roundRect = function (
            x,
            y,
            width,
            height,
            ...rest
          ) {
            paths.push({ x, y, width, height });
            return originalRect.call(this, x, y, width, height, ...rest);
          };
          CanvasRenderingContext2D.prototype.fillText = function (
            value,
            ...rest
          ) {
            captions.push(value);
            return originalText.call(this, value, ...rest);
          };
          try {
            paintCoverComponent(context, width, height, component, 1);
          } finally {
            CanvasRenderingContext2D.prototype.roundRect = originalRect;
            CanvasRenderingContext2D.prototype.fillText = originalText;
          }
          if (fixture.type === "form") {
            const panel = paths.find((path) => path.x === 0 && path.y === 0);
            const canvasTop = (height - panel.height * unit) / 2;
            const canvasLeft = (width - panel.width * unit) / 2;
            const controlPaths = paths.filter(
              (path) => path.x > 10 && path.width > 100,
            );
            const domControls = [
              ...host.querySelectorAll("input, textarea, select, button"),
            ].map((element) => {
              const bounds = element.getBoundingClientRect();
              return {
                tag: element.tagName,
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height,
              };
            });
            results.push({
              name: `${fixture.id}@${width}`,
              type: "form",
              captions,
              dom: {
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height,
              },
              canvas: {
                left: canvasLeft,
                top: canvasTop,
                width: panel.width * unit,
                height: panel.height * unit,
              },
              controls: domControls.map((dom, index) => ({
                dom,
                canvas: controlPaths[index] && {
                  left: canvasLeft + controlPaths[index].x * unit,
                  top: canvasTop + controlPaths[index].y * unit,
                  width: controlPaths[index].width * unit,
                  height: controlPaths[index].height * unit,
                },
              })),
              collecting: fixture.fields.formSubmitMode === "collect",
            });
          } else {
            const pixels = context.getImageData(0, 0, width, height).data;
            let left = width,
              top = height,
              right = -1,
              bottom = -1;
            for (let y = 0; y < height; y++)
              for (let x = 0; x < width; x++)
                if (pixels[(y * width + x) * 4 + 3] > 128) {
                  left = Math.min(left, x);
                  top = Math.min(top, y);
                  right = Math.max(right, x);
                  bottom = Math.max(bottom, y);
                }
            results.push({
              name: `${fixture.id}@${width}`,
              type: fixture.type,
              dom: {
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height,
              },
              canvas: {
                left,
                top,
                width: right - left + 1,
                height: bottom - top + 1,
              },
            });
          }
        }
    } finally {
      root.unmount();
      host.remove();
    }
    return results;
  }, font);
  for (const result of results) {
    const close = (actual, expected, label, tolerance) =>
      assert(
        Math.abs(actual - expected) <= tolerance,
        `${result.name} ${label}: canvas ${actual.toFixed(2)}, DOM ${expected.toFixed(2)}`,
      );
    if (result.type === "form") {
      // The DOM rounds fractional border widths to device pixels; allow that one-pixel boundary difference.
      for (const key of ["left", "top", "width", "height"])
        close(result.canvas[key], result.dom[key], key, 1.6);
      for (const { dom, canvas } of result.controls) {
        assert(canvas, `${result.name} missing ${dom.tag} path`);
        for (const key of ["left", "top", "width", "height"])
          close(canvas[key], dom[key], `${dom.tag} ${key}`, 1.6);
      }
      if (result.collecting)
        assert.match(
          result.captions.join(" "),
          /Your reply is sent to this video’s creator\./,
        );
    } else {
      // Existing hard shadows and centered canvas strokes extend at most three pixels past the DOM border box.
      close(result.canvas.left, result.dom.left, "left", 2);
      close(result.canvas.top, result.dom.top, "top", 2);
      close(result.canvas.width, result.dom.width, "width with shadow", 6);
      close(result.canvas.height, result.dom.height, "height with shadow", 6);
    }
  }
  console.log(
    `PASS cover layout: ${results.length} DOM/canvas cases, including text, number, yes/no, reply, styled and applied-font forms at two sizes.`,
  );
} finally {
  await browser.close();
}
