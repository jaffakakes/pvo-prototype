import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
};
const bundle = buildSync({
  stdin: {
    contents: `export * from "./editor/src/infrastructure/preferences/soundLibrary.ts"; export * from "./editor/src/state/preferences/soundLibrary.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const {
  readSoundLibrary,
  useSoundLibrary,
  toggleSavedSound,
  rememberUsedSound,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const KEY = "restyle.editor.soundLibrary";

test("bookmarks toggle independently of usage, and recent sounds retain unique newest-first order", () => {
  toggleSavedSound("Night Drive");
  rememberUsedSound("Night Drive");
  rememberUsedSound("Summer Groove");
  rememberUsedSound("Night Drive");
  assert.deepEqual(readSoundLibrary().value, {
    saved: ["Night Drive"],
    recent: ["Night Drive", "Summer Groove"],
  });
  toggleSavedSound("Night Drive");
  assert.deepEqual(readSoundLibrary().value.saved, []);
  assert.deepEqual(readSoundLibrary().value.recent, [
    "Night Drive",
    "Summer Groove",
  ]);
});

test("stored library input is bounded and rejects malformed shapes without throwing", () => {
  memory.set(
    KEY,
    JSON.stringify({
      saved: [null, 5, "", "Night Drive", "Night Drive", "x".repeat(121)],
      recent: "bad",
    }),
  );
  assert.deepEqual(readSoundLibrary(), {
    value: { saved: ["Night Drive"], recent: [] },
    failed: false,
  });
  for (const value of ["null", "[]", "broken JSON"]) {
    memory.set(KEY, value);
    assert.deepEqual(readSoundLibrary(), {
      value: { saved: [], recent: [] },
      failed: true,
    });
  }
});

test("storage denial retains session preferences and reports the persistence failure", () => {
  const storage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("quota");
    },
  };
  try {
    assert.equal(readSoundLibrary().failed, true);
    toggleSavedSound("Soft Focus");
    assert.deepEqual(useSoundLibrary.getState().saved, ["Soft Focus"]);
    assert.equal(useSoundLibrary.getState().storageSaveFailed, true);
  } finally {
    globalThis.localStorage = storage;
  }
});
