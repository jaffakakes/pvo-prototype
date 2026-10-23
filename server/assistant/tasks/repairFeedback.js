/** Only local authoring validators construct this feedback; provider exception text is excluded. */
export class AuthoringRepairError extends Error {
  constructor(check, message, proposal) {
    super("The proposed authoring decision did not pass validation.");
    this.code = "invalid_result";
    this.feedback = {
      check,
      message: boundedText(message, 2048).text,
      proposal: boundedText(
        typeof proposal === "string"
          ? proposal
          : (JSON.stringify(proposal) ?? ""),
        128 * 1024,
      ),
    };
  }
}

export function boundedText(value, maximum) {
  const encoder = new TextEncoder();
  let text = "",
    bytes = 0;
  for (const point of value) {
    const size = encoder.encode(point).length;
    if (bytes + size > maximum) return { text, truncated: true };
    text += point;
    bytes += size;
  }
  return { text, truncated: false };
}
