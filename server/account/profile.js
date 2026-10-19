import { checkOrigin, HttpError, json, readJson } from "../http.js";

const PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
export function validateProfile(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.trim().length > 120 ||
    (value.photo !== null &&
      (typeof value.photo !== "string" ||
        value.photo.length > 87000 ||
        !PHOTO.test(value.photo) ||
        !value.photo.startsWith("data:image/jpeg;base64,/9j/")))
  )
    throw new HttpError(400, "Choose a name and a JPEG photo under 64 KB.");
  return { name: value.name.trim(), photo: value.photo };
}

/** The authenticated account owns the key; caller-supplied IDs only guard account switches. */
export async function profileResponse(
  request,
  { origin, user, read, write, email = null },
) {
  if (new URL(request.url).origin !== origin)
    throw new HttpError(403, "This account address is invalid.");
  if (!user) throw new HttpError(401, "Sign in to edit your profile.");
  if (request.method === "GET") {
    const stored = await read(user.id);
    const profile = stored
      ? validateProfile(stored)
      : { name: user.name, photo: null };
    return json({ id: user.id, ...profile, email });
  }
  if (request.method !== "PUT")
    throw new HttpError(405, "This profile operation is not supported.");
  checkOrigin(request, origin);
  const body = await readJson(request, 92000);
  if (body?.id !== user.id)
    throw new HttpError(409, "Your account changed. Reopen your profile.");
  const profile = validateProfile(body);
  await write(user.id, profile);
  return json({ id: user.id, ...profile, email });
}
