import { HttpError, json } from "../http.js";
import { searchWeb } from "./search.js";
import { readWebPage } from "./read.js";

export async function webRoute(request) {
  if (request.method !== "GET") throw new HttpError(405, "Read web information with GET.");
  const url = new URL(request.url);
  if (url.pathname === "/api/web/search") return json(await searchWeb(url.searchParams.get("q"), { signal: request.signal }));
  if (url.pathname === "/api/web/read") return json(await readWebPage(url.searchParams.get("url"), { signal: request.signal }));
  throw new HttpError(404, "This web operation is unavailable.");
}
