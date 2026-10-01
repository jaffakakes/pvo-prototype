import { HttpError, json } from "../http.js";
import { leaderboardCorsHeaders, leaderboardRoute } from "./routes.js";

export async function handleLeaderboardRequest(request, env) {
  const url = new URL(request.url);
  try {
    if (!url.pathname.startsWith("/api/quizzes/"))
      throw new HttpError(404, "This quiz leaderboard is unavailable.");
    return await leaderboardRoute(request, env);
  } catch (error) {
    if (!(error instanceof HttpError))
      console.error("Quiz leaderboard request failed", request.method, url.pathname, error?.name);
    return json({ error: error instanceof HttpError ? error.message : "This operation could not finish. Please retry." },
      error instanceof HttpError ? error.status : 500, leaderboardCorsHeaders());
  }
}

export default { fetch: handleLeaderboardRequest };
