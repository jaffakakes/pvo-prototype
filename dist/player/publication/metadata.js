/** Resolve only the server's publication route; viewer query strings cannot replace it. */
export function readPublication(data, pageAddress, canonicalAddress) {
  if (data.shareable !== "true") return null;
  const id = data.publicationId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(id)) {
    throw new Error("This published video has an invalid address.");
  }
  const format = data.publicationFormat;
  const contentType = data.publicationType;
  if (format !== "pvo" && format !== "video") throw new Error("This video format is unavailable.");
  if (format === "video" && !["video/mp4", "video/webm"].includes(contentType)) {
    throw new Error("This video format is unavailable.");
  }
  const page = new URL(pageAddress);
  const media = new URL(data.publicationSrc, page);
  const canonical = new URL(canonicalAddress || `/player/${id}`, page);
  for (const [url, path] of [[media, `/media/${id}`], [canonical, `/player/${id}`]]) {
    if (!/^https?:$/.test(url.protocol) || url.origin !== page.origin || url.username || url.password
      || url.pathname !== path || url.search || url.hash) {
      throw new Error("This published video has an invalid address.");
    }
  }
  return { id, format, contentType, mediaUrl: media.href, canonicalUrl: canonical.href };
}
