import assert from "node:assert/strict";
import test from "node:test";
import { fitFootage, footageComponentScale, placeComponent, placeSticker, rectanglesIntersect } from "../player/ui/layout-geometry.js";

test("portrait footage fits phone and desktop stages without cropping", () => {
  assert.deepEqual(fitFootage(390, 708, 9 / 16), { left: 0, top: 8, width: 390, height: 693 });
  assert.deepEqual(fitFootage(1280, 640, 9 / 16), { left: 460, top: 0, width: 360, height: 640 });
  assert.deepEqual(fitFootage(834, 1054, 9 / 16), { left: 121, top: 0, width: 593, height: 1054 });
});

test("short widescreen footage lifts a form into the letterbox at readable size", () => {
  const footage = fitFootage(390, 708, 16 / 9);
  const bounds = { left: 55, top: 346, width: 280, height: 96 };
  const result = placeComponent({ stage: { width: 390, height: 708 }, footage, bounds });
  assert.equal(result.direction, "below");
  assert.equal(result.top, footage.top + footage.height + 14);
  assert.equal(result.width, 280);
  assert.equal(result.height, 96);
});

test("keyboard lift preserves authored proportions at normal reading size", () => {
  const stage = { width: 390, height: 460, contentHeight: 348 };
  const footage = fitFootage(stage.width, stage.contentHeight, 9 / 16);
  const scale = footageComponentScale(footage);
  const bounds = { left: 116, top: 270, width: 280 * scale, height: 96 * scale };
  const result = placeComponent({ stage, footage, bounds, keyboard: true });
  assert.equal(result.direction, "keyboard");
  assert.equal(result.left, 55);
  assert.equal(result.top, 356);
  assert.equal(result.width, 280);
  assert.equal(result.height, 96);
});

test("a small landscape component uses room to the right when below cannot fit", () => {
  const footage = fitFootage(1280, 400, 9 / 16);
  const bounds = { left: 550, top: 100, width: 180, height: 70 };
  const result = placeComponent({ stage: { width: 1280, height: 400 }, footage, bounds, large: true });
  assert.equal(result.direction, "right");
  assert.equal(result.left, footage.left + footage.width + 24);
});

test("a lift never moves a component on top of another component", () => {
  const stage = { width: 390, height: 708 };
  const footage = fitFootage(stage.width, stage.height, 16 / 9);
  const bounds = { left: 55, top: 346, width: 280, height: 96 };
  const occupied = [{ left: 55, top: 479, width: 280, height: 96 }];
  const result = placeComponent({ stage, footage, bounds, occupied });
  assert.equal(result.direction, "");
});

test("a bottom authored position keeps every button inside the visible stage", () => {
  const stage = { width: 854, height: 834 };
  const footage = fitFootage(stage.width, stage.height, 9 / 16);
  const bounds = { left: 250, top: 645, width: 353, height: 210 };
  const result = placeComponent({ stage, footage, bounds, large: true });
  assert.equal(result.direction, "");
  assert.equal(result.width, bounds.width);
  assert.equal(result.height, bounds.height);
  assert.ok(result.top + result.height <= stage.height - 8);
});

test("stickers move to a free gap without covering authored content", () => {
  const stage = { width: 390, height: 708 };
  const components = [{ left: 32, top: 25, width: 326, height: 120 }];
  const sticker = placeSticker({ left: 12, top: 12, width: 260, height: 44 }, stage, components);
  assert.equal(sticker.hidden, false);
  assert.equal(rectanglesIntersect(sticker, components[0]), false);
});

test("content retains priority when no sticker position can avoid it", () => {
  const stage = { width: 320, height: 200 };
  const components = [{ left: 0, top: 0, width: 320, height: 200 }];
  const sticker = placeSticker({ left: 12, top: 12, width: 260, height: 44 }, stage, components);
  assert.equal(sticker.hidden, true);
});

test("layout preserves authored motion and lower-layer placement except for focused keyboard access", () => {
  const stage = { width: 390, height: 460, contentHeight: 348 };
  const footage = fitFootage(stage.width, stage.contentHeight, 9 / 16);
  const bounds = { left: -280, top: 270, width: 280, height: 96 };
  assert.deepEqual(placeComponent({ stage, footage, bounds, preservePosition: true }), {
    ...bounds, scale: 1, direction: "",
  });
  const focused = placeComponent({ stage, footage, bounds, preservePosition: true, keyboard: true });
  assert.equal(focused.direction, "keyboard");
  assert.ok(focused.left > bounds.left);
});
