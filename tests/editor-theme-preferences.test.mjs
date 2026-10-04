import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const values = new Map();
let failRead = false;
let failWrite = false;
const originalStorage = globalThis.localStorage;
const originalFetch = globalThis.fetch;
globalThis.localStorage = {
  getItem(key) {
    if (failRead) throw new Error("Storage unavailable");
    return values.get(key) ?? null;
  },
  setItem(key, value) {
    if (failWrite) throw new Error("Storage unavailable");
    values.set(key, value);
  },
};

const bundled = buildSync({
  stdin: {
    contents: `
      export { refreshAccountSession, signOutAccount, useAuthGate } from "./editor/src/state/auth/authGateStore.ts";
      export { setThemeAccent, setThemeMode, syncThemeAccount, useThemePreferences } from "./editor/src/state/preferences/themePreferences.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { refreshAccountSession, setThemeAccent, setThemeMode, signOutAccount, syncThemeAccount,
  useAuthGate, useThemePreferences } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test.after(() => {
  globalThis.localStorage = originalStorage;
  globalThis.fetch = originalFetch;
});

test.beforeEach(() => {
  values.clear();
  failRead = false;
  failWrite = false;
  useThemePreferences.setState({
    mode: "system", accent: "magenta", userId: null,
    storageSaveFailed: false, modeStorageFailed: false, accentStorageFailed: false,
  });
  useAuthGate.setState({ user: null, phase: "idle", source: null, error: null, connecting: false });
});

const session = user => ({
  available: true,
  clerkAvailable: false,
  clerkPublishableKey: null,
  canLinkEmail: false,
  emailLinked: false,
  user,
});

test("guests can save a mode but cannot select an account accent", () => {
  setThemeMode("light");
  setThemeAccent("orange");
  assert.equal(useThemePreferences.getState().mode, "light");
  assert.equal(useThemePreferences.getState().accent, "magenta");
  assert.equal(values.get("restyle.editor.themeMode"), "light");
  assert.equal([...values.keys()].some(key => key.includes("themeAccent")), false);
  setThemeMode("invalid");
  assert.equal(useThemePreferences.getState().mode, "light");
});

test("verified account changes restore only that account's accent and logout returns to magenta", async () => {
  const first = { id: "person/one@example.com", name: "One" };
  const second = { id: "person:two", name: "Two" };
  let activeUser = first;
  globalThis.fetch = async (_path, init) => Response.json(init.method === "POST" ? { user: null } : session(activeUser));

  await refreshAccountSession();
  setThemeMode("dark");
  setThemeAccent("cyan");
  assert.equal(values.get(`restyle.editor.themeAccent.${encodeURIComponent(first.id)}`), "cyan");
  assert.equal(useThemePreferences.getState().accent, "cyan");

  activeUser = second;
  await refreshAccountSession();
  assert.equal(useThemePreferences.getState().accent, "magenta");
  setThemeAccent("violet");
  assert.equal(values.get(`restyle.editor.themeAccent.${encodeURIComponent(second.id)}`), "violet");

  activeUser = first;
  await refreshAccountSession();
  assert.equal(useThemePreferences.getState().accent, "cyan");
  await signOutAccount();
  assert.equal(useThemePreferences.getState().accent, "magenta");
  assert.equal(useThemePreferences.getState().userId, null);
  assert.equal(useThemePreferences.getState().mode, "dark");
});

test("failed writes keep the selected theme for the session and report a theme storage issue", async () => {
  const user = { id: "person-1", name: "One" };
  globalThis.fetch = async () => Response.json(session(user));
  await refreshAccountSession();

  failWrite = true;
  setThemeAccent("emerald");
  setThemeMode("light");
  assert.equal(useThemePreferences.getState().accent, "emerald");
  assert.equal(useThemePreferences.getState().mode, "light");
  assert.equal(useThemePreferences.getState().storageSaveFailed, true);
  await refreshAccountSession();
  assert.equal(useThemePreferences.getState().accent, "emerald", "a same-user check keeps an unsaved session choice");

  failWrite = false;
  setThemeAccent("blue");
  assert.equal(useThemePreferences.getState().storageSaveFailed, true, "the failed mode write still needs attention");
  setThemeMode("light");
  assert.equal(useThemePreferences.getState().storageSaveFailed, false);
  assert.equal(values.get("restyle.editor.themeMode"), "light");
});

test("a failed logout keeps an unsaved accent when the account is still signed in", async () => {
  const user = { id: "person-1", name: "One" };
  globalThis.fetch = async (_path, init) => {
    if (init.method === "POST") throw new Error("Logout response lost");
    return Response.json(session(user));
  };
  await refreshAccountSession();
  failWrite = true;
  setThemeAccent("violet");

  await assert.rejects(signOutAccount(), /Logout response lost/);
  assert.equal(useAuthGate.getState().user.id, user.id);
  assert.equal(useThemePreferences.getState().accent, "violet");
  assert.equal(useThemePreferences.getState().storageSaveFailed, true);
});

test("invalid or unreadable account storage uses the guest accent safely", () => {
  values.set("restyle.editor.themeAccent.person-1", "unknown");
  syncThemeAccount("person-1");
  assert.equal(useThemePreferences.getState().accent, "magenta");
  syncThemeAccount(null);
  failRead = true;
  syncThemeAccount("person-1");
  assert.equal(useThemePreferences.getState().accent, "magenta");
  assert.equal(useThemePreferences.getState().storageSaveFailed, true);
});
