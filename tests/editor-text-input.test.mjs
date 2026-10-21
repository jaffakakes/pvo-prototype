import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({ entryPoints: ["editor/src/domain/text/input.ts"], bundle: true, write: false, format: "esm", platform: "browser" });
const { editTextInput } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("keyboard insertion replaces the selected range and leaves the caret after the insertion", () => {
  assert.deepEqual(editTextInput("hello", 1, 4, { kind: "insert", value: "a" }), { value: "hao", cursor: 2 });
  assert.deepEqual(editTextInput("Hi", 2, 2, { kind: "insert", value: " \n" }), { value: "Hi \n", cursor: 4 });
});

test("keyboard backspace deletes selections and whole emoji or accented graphemes", () => {
  assert.deepEqual(editTextInput("hello", 1, 4, { kind: "backspace" }), { value: "ho", cursor: 1 });
  assert.deepEqual(editTextInput("hey", 2, 2, { kind: "backspace" }), { value: "hy", cursor: 1 });
  assert.deepEqual(editTextInput("hello", 0, 0, { kind: "backspace" }), { value: "hello", cursor: 0 });
  const family = "👨‍👩‍👧‍👦";
  assert.deepEqual(editTextInput(`A${family}B`, 1 + family.length, 1 + family.length, { kind: "backspace" }), { value: "AB", cursor: 1 });
  assert.deepEqual(editTextInput("Ae\u0301B", 3, 3, { kind: "backspace" }), { value: "AB", cursor: 1 });
});

test("keyboard input respects the textarea limit without splitting a grapheme", () => {
  const value = "x".repeat(499);
  assert.deepEqual(editTextInput(value, 499, 499, { kind: "insert", value: "😀" }), { value, cursor: 499 });
  assert.deepEqual(editTextInput(value, 499, 499, { kind: "insert", value: "ab" }), { value: value + "a", cursor: 500 });
  assert.deepEqual(editTextInput("x".repeat(500), 498, 500, { kind: "insert", value: "XYZ" }), { value: "x".repeat(498) + "XY", cursor: 500 });
});
