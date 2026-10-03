import assert from "node:assert/strict";
import test from "node:test";
import { matchFontCatalogue } from "../server/fonts/catalogueSearch.js";

const font = (family, category, popularity) => ({ family, category, popularity });
const catalogue = [
  font("Inter", "Sans Serif", 4), font("Open Sans", "Sans Serif", 1),
  font("Inter Tight", "Sans Serif", 2), font("Roboto", "Sans Serif", 3),
  font("Roboto Mono", "Monospace", 5), font("Roboto Serif", "Serif", 7),
  font("Playfair Display", "Serif", 10), font("Playfair Display SC", "Serif", 8),
  font("Bebas Neue", "Display", 6), font("Caveat", "Handwriting", 9),
];
const names = query => matchFontCatalogue(catalogue, query).map(item => item.family);

test("descriptive category queries return real category matches without requiring adjectives in family names", () => {
  for (const query of ["clean sans readable", "clean sans-serif readable", "easy to read sans serif font", "modern sansserif typeface"])
    assert.deepEqual(names(query), ["Open Sans", "Inter Tight", "Roboto", "Inter"]);
  assert.deepEqual(names("readable serif"), ["Roboto Serif", "Playfair Display SC", "Playfair Display"]);
  assert.deepEqual(names("clear mono"), ["Roboto Mono"]);
  assert.deepEqual(names("handwritten font"), ["Caveat"]);
  assert.deepEqual(names("simple display"), ["Bebas Neue"]);
});

test("named searches retain required name tokens and never fall back to unrelated category results", () => {
  for (const query of ["Acme Sans", "clean Acme sans readable", "Futura", "Helvetica sans",
    "readable missing mono", "Acme modern serif", "not-in-catalogue", '"Clean Sans"'])
    assert.deepEqual(names(query), [], query);
  assert.deepEqual(names("clean Inter sans readable"), ["Inter Tight", "Inter"]);
  assert.deepEqual(names("Inter missing"), []);
  assert.deepEqual(names("clean readable"), [], "Descriptions alone do not imply a named or measured match");
});

test("exact family names outrank popular variants and category-looking words remain part of known names", () => {
  assert.deepEqual(names(" iNtEr "), ["Inter", "Inter Tight"]);
  assert.deepEqual(names("Playfair Display"), ["Playfair Display", "Playfair Display SC"]);
  assert.deepEqual(names("clean Playfair Display"), ["Playfair Display SC", "Playfair Display"]);
  assert.deepEqual(names("Roboto Mono"), ["Roboto Mono"]);
  assert.deepEqual(names('"Inter"'), ["Inter"]);
  assert.deepEqual(names("Inter Tight"), ["Inter Tight"]);
});

test("Unicode name terms remain required and accented or non-Latin families match case-insensitively", () => {
  const items = [...catalogue, font("Élan Sans", "Sans Serif", 20), font("文字 Gothic", "Sans Serif", 21),
    font("Голос", "Sans Serif", 22), font("ガ Sans", "Sans Serif", 23), font("カ Sans", "Sans Serif", 24)];
  const find = query => matchFontCatalogue(items, query).map(item => item.family);
  assert.deepEqual(find("e\u0301LAN sans"), ["Élan Sans"], "Canonically equivalent accents match");
  assert.deepEqual(find("文字 gothic"), ["文字 Gothic"]);
  assert.deepEqual(find("голос"), ["Голос"]);
  assert.deepEqual(find("ガ sans"), ["ガ Sans"], "Combining marks that distinguish letters are preserved");
  for (const query of ["Inter 不存在", "clean 未知 sans", "Étrange sans", "elan sans"])
    assert.deepEqual(find(query), [], `Unknown name text must not be discarded: ${query}`);
});

test("partial family search, blank browsing and result caps remain deterministic without mutating metadata", () => {
  assert.deepEqual(names("rob"), ["Roboto", "Roboto Mono", "Roboto Serif"]);
  assert.deepEqual(names("???"), []);
  const items = Array.from({ length: 30 }, (_, index) => font(`Family ${index}`, "Sans Serif", 30 - index));
  const before = structuredClone(items);
  const result = matchFontCatalogue(items, "");
  assert.equal(result.length, 24);
  assert.equal(result[0].family, "Family 29");
  assert.deepEqual(items, before);
});
