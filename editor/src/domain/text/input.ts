export type TextInputAction =
  { kind: "insert"; value: string } | { kind: "backspace" };

/** Apply a preview-keyboard edit using the textarea's UTF-16 selection offsets. */
export function editTextInput(
  value: string,
  start: number,
  end: number,
  action: TextInputAction,
) {
  let from = start;
  if (action.kind === "backspace" && start === end) {
    const segments = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(value.slice(0, start));
    for (const segment of segments) from = segment.index;
  }
  const available = Math.max(0, 500 - (value.length - (end - from)));
  let insertion = "";
  if (action.kind === "insert") {
    for (const { segment } of new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(action.value)) {
      if (insertion.length + segment.length > available) break;
      insertion += segment;
    }
  }
  return {
    value: value.slice(0, from) + insertion + value.slice(end),
    cursor: from + insertion.length,
  };
}
