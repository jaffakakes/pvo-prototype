import { HttpError } from "../http.js";

export const TEST_MESSAGE = "Hi, how are you?";

export function testRecipient(input) {
  if (typeof input !== "string" || input.length > 40)
    throw new HttpError(400, "Enter a phone number with its country code.");
  const phone = input.replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new HttpError(400, "Enter a phone number with its country code, such as +44…");
  return phone;
}

export function testConsent(input) {
  if (input !== true)
    throw new HttpError(400, "Confirm that you want the test iMessage before sending.");
}
