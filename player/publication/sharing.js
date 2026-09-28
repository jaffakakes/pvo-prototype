/** Only a ready publication has a public link; local files never use the page address. */
export function createPublicationSharing({ publication, buttons = [], title, setStatus, capabilities = navigator }) {
  let timer;
  let disposed = false;
  buttons.filter(Boolean).forEach(button => { button.hidden = !publication; });

  async function share() {
    if (!publication || disposed) return false;
    const data = { title, url: publication.canonicalUrl };
    try {
      if (typeof capabilities.share === "function") await capabilities.share(data);
      else {
        if (!capabilities.clipboard?.writeText) throw new Error("Clipboard unavailable.");
        await capabilities.clipboard.writeText(data.url);
        if (disposed) return false;
        setStatus("Link copied", false, true);
        clearTimeout(timer);
        timer = setTimeout(() => setStatus(""), 1600);
      }
      return true;
    } catch (error) {
      if (!disposed && error?.name !== "AbortError") setStatus("Could not share this link.", true);
      return false;
    }
  }

  return { share, destroy() { disposed = true; clearTimeout(timer); } };
}
