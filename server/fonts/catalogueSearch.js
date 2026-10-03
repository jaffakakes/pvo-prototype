// These words describe intent, not measured attributes of a font. Ignore them
// only beside an explicit supported category; unknown family terms stay required.
const descriptors = new Set([
  "clean", "clear", "readable", "legible", "modern", "simple", "minimal", "minimalist",
  "font", "fonts", "typeface", "typefaces", "easy", "to", "read",
]);
const categories = new Map([
  ["sans", "sans serif"], ["sansserif", "sans serif"], ["serif", "serif"],
  ["mono", "monospace"], ["monospaced", "monospace"], ["monospace", "monospace"],
  ["handwriting", "handwriting"], ["handwritten", "handwriting"],
  ["script", "handwriting"], ["cursive", "handwriting"], ["display", "display"],
]);
const normalize = value => value.normalize("NFKC").toLowerCase().normalize("NFC")
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();

function queryTerms(words) {
  const requestedCategories = new Set();
  const remaining = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const category = categories.get(word);
    if (!category) remaining.push(word);
    else {
      requestedCategories.add(category);
      if (word === "sans" && words[index + 1] === "serif") index++;
    }
  }
  const descriptive = requestedCategories.size > 0;
  return {
    categories: requestedCategories,
    names: remaining.filter(word => !descriptive || !descriptors.has(word)),
    phrase: words.filter(word => !descriptive || !descriptors.has(word)),
  };
}

/** Rank actual catalogue entries; unrecognized name terms never trigger a fallback. */
export function matchFontCatalogue(items, query) {
  const text = query.trim();
  const normalized = normalize(text);
  if (text && !normalized) return [];
  const words = normalized.split(" ").filter(Boolean);
  const terms = queryTerms(words);
  const quotedName = /^(".*"|'.*')$/.test(text);
  return items.map(item => {
    const family = normalize(item.family);
    const exact = Boolean(normalized) && family === normalized;
    const namedPhrase = terms.names.length > 0 && terms.phrase.every(word => family.includes(word));
    const matchesCategory = [...terms.categories].every(category => normalize(item.category) === category);
    const matchesName = terms.names.every(word => family.includes(word));
    const matches = quotedName ? exact : exact || namedPhrase || matchesCategory && matchesName;
    return { item, matches, exact, namedPhrase };
  }).filter(result => result.matches)
    .sort((left, right) => Number(right.exact) - Number(left.exact)
      || Number(right.namedPhrase) - Number(left.namedPhrase)
      || left.item.popularity - right.item.popularity
      || left.item.family.localeCompare(right.item.family))
    .slice(0, 24).map(result => result.item);
}
