import { HttpError, json, readJson } from "../http.js";
import { answerInput, completionInput, leaderboardLimit } from "./input.js";
import {
  completeAttempt,
  leaderboardClientKey,
  readLeaderboard,
  recordAnswer,
  startAnswerAttempt,
} from "./repository.js";
import { BIBLE_QUIZ_ID } from "./quiz.js";

const ROUTE = /^\/api\/quizzes\/([^/]+)\/(answers|complete|leaderboard)$/;

export function leaderboardCorsHeaders() {
  return { "Access-Control-Allow-Origin": "*" };
}

function preflight(resource) {
  const method = resource === "leaderboard" ? "GET, OPTIONS" : "POST, OPTIONS";
  return new Response(null, { status: 204, headers: {
    ...leaderboardCorsHeaders(),
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": method,
    "Access-Control-Max-Age": "600",
  } });
}

function requireLeaderboardEnvironment(env) {
  if (!env.DB || typeof env.LEADERBOARD_SECRET !== "string" || env.LEADERBOARD_SECRET.length < 32)
    throw new HttpError(503, "The quiz leaderboard is unavailable. Please try again later.");
}

export async function leaderboardRoute(request, env) {
  const url = new URL(request.url);
  const match = ROUTE.exec(url.pathname);
  if (!match || match[1] !== BIBLE_QUIZ_ID)
    throw new HttpError(404, "This quiz leaderboard is unavailable.");
  const resource = match[2];
  if (request.method === "OPTIONS") return preflight(resource);
  requireLeaderboardEnvironment(env);

  if (resource === "leaderboard") {
    if (request.method !== "GET") throw new HttpError(405, "This leaderboard operation is not supported.");
    return json(await readLeaderboard(env.DB, leaderboardLimit(url)), 200, leaderboardCorsHeaders());
  }

  if (request.method !== "POST") throw new HttpError(405, "This quiz operation is not supported.");
  if (resource === "complete") {
    const input = completionInput(await readJson(request, 2048));
    return json(await completeAttempt(env.DB, input), 200, leaderboardCorsHeaders());
  }
  const input = answerInput(await readJson(request, 2048));
  if (!input.startsAttempt)
    return json(await recordAnswer(env.DB, input), 200, leaderboardCorsHeaders());
  const clientKey = await leaderboardClientKey(request, env.LEADERBOARD_SECRET);
  return json(await startAnswerAttempt(env.DB, clientKey, input), 201, leaderboardCorsHeaders());
}
