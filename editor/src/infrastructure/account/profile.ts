import type { AccountSession } from "../auth/client";
export type AccountProfile = {
  id: string;
  name: string;
  email: string | null;
  photo: string | null;
};

async function profileRequest(
  _session: AccountSession,
  init: RequestInit,
): Promise<AccountProfile> {
  const response = await fetch("/api/account/profile", {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Couldn't save your profile. Try again.");
  const data: unknown = await response.json();
  if (!data || typeof data !== "object")
    throw new Error("Invalid profile response");
  const value = data as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    (value.email !== null && typeof value.email !== "string") ||
    (value.photo !== null &&
      (typeof value.photo !== "string" ||
        value.photo.length > 87000 ||
        !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(
          value.photo,
        )))
  )
    throw new Error("Invalid profile response");
  return value as AccountProfile;
}
export const loadAccountProfile = (session: AccountSession) =>
  profileRequest(session, { method: "GET" });
export const saveAccountProfile = (
  session: AccountSession,
  profile: AccountProfile,
) =>
  profileRequest(session, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });

/** Decode once, crop to the avatar square, and keep uploaded account photos bounded. */
export async function prepareAccountPhoto(file: File): Promise<string> {
  if (
    !/^image\/(jpeg|png|webp|avif)$/.test(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error("Choose a JPG, PNG, WebP or AVIF photo under 10 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Couldn't prepare photo");
    const size = Math.min(bitmap.width, bitmap.height);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 256, 256);
    context.drawImage(
      bitmap,
      (bitmap.width - size) / 2,
      (bitmap.height - size) / 2,
      size,
      size,
      0,
      0,
      256,
      256,
    );
    const photo = canvas.toDataURL("image/jpeg", 0.8);
    if (photo.length > 87000) throw new Error("Choose a smaller photo.");
    return photo;
  } finally {
    bitmap.close();
  }
}
