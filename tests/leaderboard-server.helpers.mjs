import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import { bundleWorkerModules } from "./worker-bundle.helpers.mjs";

export const LEADERBOARD_ORIGIN = "https://quiz.example";
export const PLAYER_ORIGIN = "https://player.example";
export const LEADERBOARD_SECRET = "leaderboard-test-secret-at-least-thirty-two-characters";
export const CORRECT_ANSWERS = ["a", "b", "a", "a", "b", "a", "a", "b", "a", "b", "a", "b", "a", "b", "a"];

let modules;

export async function leaderboardFixture(bindings = {}) {
  modules ??= bundleWorkerModules({ entryPoints: ["server/leaderboards/worker.js"] });
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: "leaderboard-test",
    modules: await modules,
    compatibilityDate: "2026-09-27",
    d1Databases: ["DB"],
    bindings: { LEADERBOARD_SECRET, ...bindings },
  }));
  let db;
  try {
    db = await mf.getD1Database("DB");
    const migration = await readFile("migrations/leaderboards/0001_quiz_leaderboard.sql", "utf8");
    const statements = migration.trim().split(/;\s*(?=CREATE\s)/u).map(sql => sql.trim()).filter(Boolean);
    await db.batch(statements.map(sql => db.prepare(sql)));
  } catch (error) {
    await mf.dispose();
    throw error;
  }
  async function request(path, {
    method = "GET",
    body,
    headers = {},
    address = "192.0.2.1",
  } = {}) {
    return mf.dispatchFetch(`${LEADERBOARD_ORIGIN}${path}`, {
      method,
      body,
      headers: {
        Origin: PLAYER_ORIGIN,
        "CF-Connecting-IP": address,
        ...headers,
      },
    });
  }
  return { mf, db, request, close: () => mf.dispose() };
}

export async function answer(fixture, attempt, question, answerId, options = {}) {
  const credentials = attempt ? {
    attemptId: attempt.attemptId,
    attemptToken: attempt.attemptToken,
  } : {};
  const response = await fixture.request("/api/quizzes/bible-quiz-v1/answers", {
    method: "POST",
    body: JSON.stringify({
      ...credentials,
      questionId: `q${question}`,
      answerId,
    }),
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  return { response, body: await response.json() };
}

export function startAttempt(fixture, answerId = CORRECT_ANSWERS[0], options = {}) {
  return answer(fixture, null, 1, answerId, options);
}

export async function finishQuestions(fixture, attempt, answers = CORRECT_ANSWERS) {
  let result = { body: attempt };
  for (let index = 1; index < answers.length; index += 1)
    result = await answer(fixture, attempt, index + 1, answers[index]);
  return result;
}

export async function submitCompletion(fixture, attempt, displayName, publicConsent = true, options = {}) {
  const response = await fixture.request("/api/quizzes/bible-quiz-v1/complete", {
    method: "POST",
    body: JSON.stringify({
      attemptId: attempt.attemptId,
      attemptToken: attempt.attemptToken,
      displayName,
      publicConsent,
    }),
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  return { response, body: await response.json() };
}

export async function createCompletedAttempt(fixture, displayName, publicConsent = true, answers = CORRECT_ANSWERS) {
  const started = await startAttempt(fixture, answers[0]);
  await finishQuestions(fixture, started.body, answers);
  return submitCompletion(fixture, started.body, displayName, publicConsent);
}
