/** Only call with values already validated against the closed JSON contract. */
export function canonicalJson(value) {
  const ordered = (item) =>
    Array.isArray(item)
      ? item.map(ordered)
      : item !== null && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, ordered(item[key])]),
          )
        : item;
  return JSON.stringify(ordered(value));
}
