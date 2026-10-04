import { HttpError } from "../http.js";

export const MAX_REPLY_ANSWERS = 5;
export const MAX_REPLY_VALUE_LENGTH = 1024;

export function replyBoxInput(value) {
  const title = typeof value?.title === "string" ? value.title.trim() : "";
  if (!title || title.length > 120 || /[\u0000-\u001f\u007f]/.test(title))
    throw new HttpError(400, "Give this reply box a title of up to 120 characters.");
  return { title };
}

export function replyInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !Array.isArray(value.answers) || value.answers.length < 1 || value.answers.length > MAX_REPLY_ANSWERS)
    throw new HttpError(400, "Send between one and five answers.");
  let hasAnswer = false;
  const answers = value.answers.map(answer => {
    const rawName = answer?.name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const type = answer?.type;
    const entry = answer?.value;
    if (!name || rawName.length > 24 || /[\u0000-\u001f\u007f]/.test(rawName)
      || !["text", "number", "yesno"].includes(type))
      throw new HttpError(400, "One of the answer fields is invalid.");
    if (type === "text") {
      if (typeof entry !== "string" || entry.length > MAX_REPLY_VALUE_LENGTH
        || /[\u0000\u007f]/.test(entry))
        throw new HttpError(400, "One of the answers is invalid or too long.");
      hasAnswer ||= Boolean(entry.trim());
    } else if (type === "number") {
      if (!(typeof entry === "number" && Number.isFinite(entry)) && entry !== "")
        throw new HttpError(400, "Enter a valid number.");
      hasAnswer ||= entry !== "";
    } else {
      if (typeof entry !== "boolean") throw new HttpError(400, "Choose Yes or No.");
      hasAnswer = true;
    }
    return { name, type, value: entry };
  });
  if (!hasAnswer) throw new HttpError(400, "Add an answer before sending.");
  return { answers };
}
