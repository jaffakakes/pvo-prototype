import { getAccountSession } from "../auth/sessions.js";
import { HttpError } from "../http.js";
import { profileResponse } from "./profile.js";

export async function accountProfileRoute(request, env, config) {
  if (!env.MEDIA)
    throw new HttpError(
      503,
      "Profile storage is unavailable. Try again later.",
    );
  return profileResponse(request, {
    origin: config.origin,
    user: await getAccountSession(request, env),
    read: async (id) =>
      (await env.MEDIA.get(`account-profiles/${id}.json`))?.json() ?? null,
    write: (id, profile) =>
      env.MEDIA.put(`account-profiles/${id}.json`, JSON.stringify(profile), {
        httpMetadata: { contentType: "application/json" },
      }),
  });
}
