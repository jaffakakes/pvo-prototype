import { digest, randomId } from "../identity.js";
import { HttpError } from "../http.js";
import { bibleQuizAnswerScore, BIBLE_QUIZ_ID, BIBLE_QUIZ_QUESTION_COUNT } from "./quiz.js";

const ATTEMPTS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

function attemptResult(row, attemptId, attemptToken) {
  return {
    attemptId,
    attemptToken,
    quizId: BIBLE_QUIZ_ID,
    displayName: row.display_name,
    publicConsent: row.public_consent === null ? null : Boolean(row.public_consent),
    score: row.score,
    total: BIBLE_QUIZ_QUESTION_COUNT,
    answered: row.answered_count,
    complete: row.completed_at !== null,
    text: `Score: ${row.score}/${BIBLE_QUIZ_QUESTION_COUNT}`,
  };
}

function createAttemptStatement(db, clientKey, id, tokenHash, now) {
  return db.prepare(`INSERT INTO quiz_attempts
    (id, quiz_id, token_hash, client_key, created_at)
    SELECT ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM quiz_attempts WHERE client_key = ? AND created_at >= ?) < ?`)
    .bind(id, BIBLE_QUIZ_ID, tokenHash, clientKey, now, clientKey, now - HOUR_MS, ATTEMPTS_PER_HOUR);
}

function recordAnswerStatement(db, input, tokenHash, now) {
  const correct = bibleQuizAnswerScore(input.questionId, input.answerId);
  return db.prepare(`INSERT INTO quiz_answers
    (attempt_id, quiz_id, question_id, answer_id, correct, answered_at)
    SELECT id, quiz_id, ?, ?, ?, ? FROM quiz_attempts
    WHERE id = ? AND quiz_id = ? AND token_hash = ? AND completed_at IS NULL
    ON CONFLICT(attempt_id, question_id) DO NOTHING`)
    .bind(input.questionId, input.answerId, correct, now, input.attemptId, BIBLE_QUIZ_ID, tokenHash);
}

async function readRecordedAnswer(db, input, tokenHash) {
  return db.prepare(`SELECT attempts.display_name, attempts.public_consent, attempts.score,
      attempts.answered_count, attempts.completed_at, answers.answer_id, answers.correct
    FROM quiz_attempts AS attempts
    JOIN quiz_answers AS answers ON answers.attempt_id = attempts.id AND answers.question_id = ?
    WHERE attempts.id = ? AND attempts.quiz_id = ? AND attempts.token_hash = ?`)
    .bind(input.questionId, input.attemptId, BIBLE_QUIZ_ID, tokenHash).first();
}

function answerResult(row, input, accepted, started) {
  if (!row) throw new HttpError(404, "This quiz attempt is unavailable. Start a new attempt.");
  if (!accepted && row.answer_id !== input.answerId)
    throw new HttpError(409, "This question already has a different recorded answer.");
  return {
    ...attemptResult(row, input.attemptId, input.attemptToken),
    questionId: input.questionId,
    answerId: row.answer_id,
    accepted,
    correct: Boolean(row.correct),
    started,
  };
}

export async function startAnswerAttempt(db, clientKey, input, now = Date.now()) {
  const id = randomId();
  const token = randomId(32);
  const tokenHash = await digest(token);
  const attempt = { ...input, attemptId: id, attemptToken: token };
  const [created, answered] = await db.batch([
    createAttemptStatement(db, clientKey, id, tokenHash, now),
    recordAnswerStatement(db, attempt, tokenHash, now),
  ]);
  if (!created.meta.changes)
    throw new HttpError(429, "Too many quiz attempts were started from this connection. Try again later.");
  if (!answered.meta.changes)
    throw new Error("Anonymous quiz attempt was created without its first answer.");
  return answerResult(await readRecordedAnswer(db, attempt, tokenHash), attempt, true, true);
}

export async function recordAnswer(db, input, now = Date.now()) {
  const tokenHash = await digest(input.attemptToken);
  const result = await recordAnswerStatement(db, input, tokenHash, now).run();
  const row = await readRecordedAnswer(db, input, tokenHash);
  return answerResult(row, input, result.meta.changes > 0, false);
}

export async function completeAttempt(db, input, now = Date.now()) {
  const tokenHash = await digest(input.attemptToken);
  const result = await db.prepare(`UPDATE quiz_attempts
    SET display_name = ?, public_consent = ?, completed_at = ?
    WHERE id = ? AND quiz_id = ? AND token_hash = ? AND completed_at IS NULL AND answered_count = ?`)
    .bind(input.displayName, input.publicConsent ? 1 : 0, now, input.attemptId, BIBLE_QUIZ_ID, tokenHash,
      BIBLE_QUIZ_QUESTION_COUNT).run();
  const row = await db.prepare(`SELECT display_name, public_consent, score, answered_count, completed_at
    FROM quiz_attempts WHERE id = ? AND quiz_id = ? AND token_hash = ?`)
    .bind(input.attemptId, BIBLE_QUIZ_ID, tokenHash).first();
  if (!row) throw new HttpError(404, "This quiz attempt is unavailable. Start a new attempt.");
  if (row.answered_count !== BIBLE_QUIZ_QUESTION_COUNT)
    throw new HttpError(409, "Answer every quiz question before submitting your name.");
  if (row.completed_at === null)
    throw new HttpError(409, "The final answer is still being recorded. Retry your submission.");
  if (!result.meta.changes
      && (row.display_name !== input.displayName || Boolean(row.public_consent) !== input.publicConsent))
    throw new HttpError(409, "This quiz attempt was already submitted with different details.");
  const leaderboard = await readLeaderboard(db, 5);
  return {
    ...attemptResult(row, input.attemptId, input.attemptToken),
    accepted: result.meta.changes > 0,
    entries: leaderboard.entries,
    text: leaderboard.text,
  };
}

export async function readLeaderboard(db, limit) {
  const { results } = await db.prepare(`SELECT rank, display_name, score, completed_at FROM (
      SELECT ROW_NUMBER() OVER (ORDER BY score DESC, completed_at ASC, id ASC) AS rank,
        display_name, score, completed_at
      FROM quiz_attempts
      WHERE quiz_id = ? AND public_consent = 1 AND completed_at IS NOT NULL
    ) ORDER BY rank LIMIT ?`).bind(BIBLE_QUIZ_ID, limit).all();
  const entries = results.map(row => ({
    rank: Number(row.rank),
    displayName: row.display_name,
    score: row.score,
    total: BIBLE_QUIZ_QUESTION_COUNT,
  }));
  const lines = entries.length
    ? entries.map(entry => `${entry.rank}. ${entry.displayName} — ${entry.score}/${BIBLE_QUIZ_QUESTION_COUNT}`)
    : ["No completed scores yet."];
  return {
    quizId: BIBLE_QUIZ_ID,
    total: BIBLE_QUIZ_QUESTION_COUNT,
    entries,
    text: ["Leaderboard", ...lines].join("\n"),
  };
}

export async function leaderboardClientKey(request, secret) {
  const address = request.headers.get("CF-Connecting-IP")?.trim() || "unknown";
  return digest(`quiz-attempt\0${secret}\0${address}`);
}
