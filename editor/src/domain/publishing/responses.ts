import type { Publication, PublicationReservation, PublishingStatus } from "./model";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid publishing response.");
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error("Invalid publishing response.");
  return value;
}
function id(value: unknown): string {
  const result = text(value, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new Error("Invalid publication identifier.");
  return result;
}
function safeUrl(value: unknown, origin: string, path: string): string {
  const url = new URL(text(value), origin);
  if (url.origin !== origin || url.username || url.password || !url.pathname.startsWith(path)) throw new Error("Invalid publishing destination.");
  return url.href;
}
export const unavailablePublishing: PublishingStatus = { available: false, hasSession: false, maxBytes: 50 * 1024 * 1024 };

export function publishingStatus(value: unknown): PublishingStatus {
  const input = object(value);
  if (typeof input.available !== "boolean" || typeof input.hasSession !== "boolean"
    || typeof input.maxBytes !== "number" || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 0)
    throw new Error("Invalid publishing status.");
  return { available: input.available, hasSession: input.hasSession, maxBytes: input.maxBytes };
}

export function publicationReservation(value: unknown, origin: string): PublicationReservation {
  const input = object(value);
  const publicationId = id(input.id);
  if (input.status !== "pending" && input.status !== "ready") throw new Error("Invalid publication status.");
  const url = safeUrl(input.url, origin, `/player/${publicationId}`);
  const parsed = new URL(url);
  if (parsed.pathname !== `/player/${publicationId}` || parsed.search || parsed.hash) throw new Error("Invalid publication destination.");
  return { id: publicationId, url, status: input.status };
}

export function publicationList(value: unknown, origin: string): Publication[] {
  const input = object(value);
  if (!Array.isArray(input.publications)) throw new Error("Invalid publication list.");
  return input.publications.map(value => {
    const item = object(value);
    const reservation = publicationReservation({ ...item, status: "ready" }, origin);
    if ((item.format !== "pvo" && item.format !== "video") || typeof item.bytes !== "number" || !Number.isSafeInteger(item.bytes) || item.bytes < 0)
      throw new Error("Invalid published file.");
    return { id: reservation.id, url: reservation.url, title: text(item.title, 120),
      createdAt: text(item.createdAt, 80), format: item.format, bytes: item.bytes };
  });
}
