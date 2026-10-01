import { HttpError } from "../http.js";
import { isBibleQuizAnswer, isBibleQuizQuestion } from "./quiz.js";

const ATTEMPT_ID = /^[A-Za-z0-9_-]{22}$/;
const ATTEMPT_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UNSAFE_NAME_CHARACTERS = /\p{C}/u;

function objectInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Send a valid quiz request.");
  return value;
}

function displayName(value) {
  if (typeof value !== "string" || UNSAFE_NAME_CHARACTERS.test(value))
    throw new HttpError(400, "Enter a valid display name.");
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const length = [...normalized].length;
  if (length < 1 || length > 32)
    throw new HttpError(400, "Display names must contain 1 to 32 characters.");
  return normalized;
}

export function answerInput(value) {
  const input = objectInput(value);
  if (!isBibleQuizQuestion(input.questionId) || !isBibleQuizAnswer(input.answerId))
    throw new HttpError(400, "Send a valid quiz answer.");
  const startsAttempt = input.attemptId === undefined && input.attemptToken === undefined;
  if (startsAttempt && input.questionId !== "q1")
    throw new HttpError(400, "Start a quiz attempt with its first answer.");
  if (!startsAttempt
      && (!ATTEMPT_ID.test(input.attemptId ?? "") || !ATTEMPT_TOKEN.test(input.attemptToken ?? "")))
    throw new HttpError(400, "Send a valid quiz attempt.");
  return {
    attemptId: startsAttempt ? null : input.attemptId,
    attemptToken: startsAttempt ? null : input.attemptToken,
    questionId: input.questionId,
    answerId: input.answerId,
    startsAttempt,
  };
}

export function completionInput(value) {
  const input = objectInput(value);
  if (!ATTEMPT_ID.test(input.attemptId ?? "") || !ATTEMPT_TOKEN.test(input.attemptToken ?? ""))
    throw new HttpError(400, "Send a valid quiz attempt.");
  if (typeof input.publicConsent !== "boolean")
    throw new HttpError(400, "Choose whether your score may appear publicly.");
  return {
    attemptId: input.attemptId,
    attemptToken: input.attemptToken,
    displayName: displayName(input.displayName),
    publicConsent: input.publicConsent,
  };
}

export function leaderboardLimit(url) {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 5;
  if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(raw))
    throw new HttpError(400, "Leaderboard limits must be between 1 and 50.");
  return Number(raw);
}
