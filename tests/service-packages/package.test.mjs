import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  matchServicePackage,
  supportedNodeLibraries,
  resolveNodeLibraries,
  parseServiceFilePath,
  parseServicePackage,
  serializeServiceAgreement,
  serializeServicePackage,
  SERVICE_PACKAGE_LIMITS as limits,
} from "../../packages/pvo-assistant/services/index.js";
import { dinnerAgreement, sourcePackage } from "./fixtures.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("source package binds exact module bytes to the saved behavior digest without granting readiness", () => {
  const digest = sha256(serializeServiceAgreement(dinnerAgreement()));
  const source = sourcePackage(digest);
  const parsed = matchServicePackage(source, digest);
  assert.deepEqual(parsed, source);
  assert.notEqual(parsed.files, source.files);
  assert.throws(
    () => matchServicePackage(source, "b".repeat(64)),
    /different behavior/,
  );
  assert.throws(() => matchServicePackage(source, "not-a-digest"));
  for (const extra of [
    { passed: true },
    { ready: true },
    { url: "https://example.invalid" },
    { credentials: {} },
    { scripts: { install: "echo hi" } },
  ])
    assert.throws(() => parseServicePackage({ ...source, ...extra }));
  assert.equal(parsed.files[0].content, source.files[0].content);
  const before = sha256(serializeServicePackage(source));
  parsed.files[0].content += "\n";
  assert.notEqual(sha256(serializeServicePackage(parsed)), before);
  assert.equal(sha256(serializeServicePackage(source)), before);
});

test("service paths reject traversal, absolute paths, hidden files, aliases and unsupported modules", () => {
  for (const path of [
    "/src/service.mjs",
    "src/../service.mjs",
    "src/./service.mjs",
    "src//service.mjs",
    "src\\service.mjs",
    "src/%2e%2e/service.mjs",
    "src/service.mjs\0",
    "src/service.mjs?x",
    "Src/service.mjs",
    "src/.env.mjs",
    "node_modules/pkg/index.mjs",
    "package.json",
    "https://example.invalid/a.mjs",
    "src/a.js",
    "src/é.mjs",
    "src/" + "a".repeat(160) + ".mjs",
  ])
    assert.throws(() => parseServiceFilePath(path), path);
  for (const path of [
    "src/service.mjs",
    "src/rules/overlap.mjs",
    "tests/capacity.test.mjs",
  ])
    assert.equal(parseServiceFilePath(path), path);
});

test("package requires existing unique entry point/tests and a closed supported dependency lock", () => {
  const mutations = [
    (p) => (p.runtime = "node-unrestricted"),
    (p) => p.dependencies.push({ name: "anything", version: "latest" }),
    (p) => (p.dependencies = {}),
    (p) => p.files.push({ ...p.files[0] }),
    (p) => (p.files = p.files.slice(1)),
    (p) => (p.entrypoint = "tests/service.test.mjs"),
    (p) => (p.tests = []),
    (p) => p.tests.push(p.tests[0]),
    (p) => (p.tests = ["tests/missing.test.mjs"]),
    (p) => (p.tests = ["src/service.mjs"]),
    (p) => (p.files[0].symlink = "../../private"),
    (p) => (p.files[0].content = { passed: true }),
    (p) => (p.agreementDigest = "a".repeat(63)),
  ];
  for (const mutate of mutations) {
    const source = sourcePackage();
    mutate(source);
    assert.throws(() => parseServicePackage(source));
  }
});

test("UTF-8 per-file, total serialized bytes and file count are independently bounded", () => {
  const source = sourcePackage();
  source.files[0].content = "é".repeat(limits.fileBytes / 2);
  assert.doesNotThrow(() => parseServicePackage(source));
  source.files[0].content += "é";
  assert.throws(() => parseServicePackage(source), /byte limit/);
  source.files[0].content = "x".repeat(limits.fileBytes);
  for (let i = 0; i < 7; i++)
    source.files.push({
      path: `src/f${i}.mjs`,
      content: "x".repeat(limits.fileBytes),
    });
  assert.throws(() => parseServicePackage(source), /total byte limit/);
  const many = sourcePackage();
  for (let i = 0; i < limits.files; i++)
    many.files.push({ path: `src/f${i}.mjs`, content: "" });
  assert.throws(() => parseServicePackage(many), /item limit/);
});

test("canonical package content keeps object key ordering irrelevant and source whitespace significant", () => {
  const source = sourcePackage();
  const reordered = Object.fromEntries(Object.entries(source).reverse());
  reordered.files = source.files.map(({ path, content }) => ({
    content,
    path,
  }));
  assert.equal(
    serializeServicePackage(source),
    serializeServicePackage(reordered),
  );
  const altered = sourcePackage();
  altered.files[0].content = altered.files[0].content.replace(/ /g, "  ");
  assert.notEqual(
    serializeServicePackage(source),
    serializeServicePackage(altered),
  );
});

test("the checked identity includes exact runtime and retained library bytes; unsupported selections cannot enter it", () => {
  const source = sourcePackage(),
    before = serializeServicePackage(source);
  source.dependencies = resolveNodeLibraries(["nanoid@5.1.6"]);
  assert.deepEqual(source.dependencies, supportedNodeLibraries());
  assert.notEqual(serializeServicePackage(source), before);
  for (const key of Object.keys(source.runtime)) {
    const changed = structuredClone(source);
    changed.runtime[key] = "changed";
    assert.throws(() => parseServicePackage(changed));
  }
  for (const field of ["version", "registryIntegrity"]) {
    const changed = structuredClone(source);
    changed.dependencies[0][field] = "changed";
    assert.throws(() => parseServicePackage(changed));
  }
  const changed = structuredClone(source);
  changed.dependencies[0].files[0].content += "changed";
  assert.throws(() => parseServicePackage(changed));
  for (const values of [
    ["nanoid@latest"],
    ["nanoid@5.1.6", "nanoid@5.1.6"],
    ["unapproved@1.0.0"],
  ])
    assert.throws(() => resolveNodeLibraries(values));
  const unsafe = structuredClone(source);
  let read = false;
  Object.defineProperty(unsafe.dependencies[0], "files", {
    enumerable: true,
    get() {
      read = true;
      throw new Error("accessor");
    },
  });
  assert.throws(() => parseServicePackage(unsafe));
  assert.equal(read, false);
});
