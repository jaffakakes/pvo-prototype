import assert from "node:assert/strict";
import test from "node:test";
import { parseNativeTurnResult, parseNativeObservation } from "../packages/pvo-assistant/native/index.js";

const requests = [
  { kind: "web_search", query: "Swiss poster typography design references" },
  { kind: "web_read", url: "https://independent.example/designs/poster" },
  { kind: "font_catalogue", query: "serif" },
  { kind: "saved_fonts" },
  { kind: "font_import", family: "Independent Font", url: "https://independent.example/type/font.ttf", licenseUrl: "https://independent.example/type/OFL.txt" },
];
const font = { id: "web-independent", family: "Independent Font" };
const observations = [
  { kind: "web_search", query: requests[0].query, results: [{ title: "Poster designs", url: requests[1].url, snippet: "A designer's typography examples." }], source: "Web search", retrievedAt: "2026-10-03T12:00:00Z" },
  { kind: "web_read", url: requests[1].url, title: "Poster designs", text: "Design reference content", links: [{ title: "Font", url: requests[4].url }], retrievedAt: "2026-10-03T12:00:00Z", truncated: false },
  { kind: "font_catalogue", query: "serif", fonts: [{ ...font, category: "serif" }] },
  { kind: "saved_fonts", fonts: [{ ...font, sourceUrl: requests[4].url }] },
  { kind: "font_import", font, sourceUrl: requests[4].url, licenseUrl: requests[4].licenseUrl },
  { kind: "web_unavailable", requestedKind: "web_read", message: "This page could not be read." },
];

test("generic web/design searches and arbitrary-host font imports cross the scene-independent tool contract", () => {
  for (const request of requests) {
    const result = { message: "Finding a reference", operations: [], observations: [request] };
    assert.deepEqual(parseNativeTurnResult(result), result);
  }
  for (const observation of observations) assert.deepEqual(parseNativeObservation(observation), observation);
});

test("web tool requests reject unbounded text, unsafe protocols and undeclared network options", () => {
  for (const request of [
    { kind: "web_search", query: "" },
    { kind: "web_search", query: "x".repeat(301) },
    { kind: "web_search", query: "design", sceneId: "main" },
    { kind: "web_read", url: "http://example.com" },
    { kind: "web_read", url: "javascript:alert(1)" },
    { kind: "web_read", url: "https://example.com", headers: { Authorization: "secret" } },
    { ...requests[4], url: "file:///private/font.ttf" },
    { ...requests[4], licenseUrl: "data:text/plain,licence" },
    { kind: "saved_fonts", includeBytes: true },
  ]) assert.throws(() => parseNativeTurnResult({ message: "Searching", operations: [], observations: [request] }));
});

test("web observations remain bounded provenance and never carry binary font data", () => {
  for (const observation of [
    { ...observations[0], results: Array(11).fill(observations[0].results[0]) },
    { ...observations[1], text: "x".repeat(16001) },
    { ...observations[1], links: Array(21).fill(observations[1].links[0]) },
    { ...observations[3], fonts: [{ ...font, sourceUrl: requests[4].url, dataUrl: "data:font/ttf;base64,AAAA" }] },
    { ...observations[4], font: { ...font, faces: [] } },
    { kind: "web_unavailable", requestedKind: "transcript", message: "Wrong tool channel" },
  ]) assert.throws(() => parseNativeObservation(observation));
});
