import { readPlayerElements } from "../ui/elements.js";
import { readPublication } from "./metadata.js";
import { mountPlainPublication } from "./plain.js";

const refs = readPlayerElements();
document.querySelector("#publicationRetry")?.addEventListener("click", () => window.location.reload());

try {
  const publication = readPublication(document.body.dataset, window.location.href,
    document.querySelector('link[rel="canonical"]')?.href);
  if (!publication) throw new Error("This video is unavailable.");
  if (publication.format === "video") mountPlainPublication({ publication, refs, title: document.title });
  else {
    document.body.dataset.pvoSrc = publication.mediaUrl;
    await import("../app.js");
  }
} catch {
  refs.empty.hidden = false;
  refs.shell.hidden = true;
}
