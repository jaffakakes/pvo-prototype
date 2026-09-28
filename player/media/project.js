import { readPvo, validatePvo } from "../../packages/pvo-sdk/index.js";
import { readPvoLanguage } from "../components/language.js";

export function createProjectLoader({ session, refs, adapters }) {
  function revokeAssetUrls() {
    session.assetUrls.forEach((url) => URL.revokeObjectURL(url));
    session.assetUrls = new Map();
  }

  async function openPvo(file, { autoplay = false } = {}) {
    if (!file) return;
    adapters.setStatus("Loading…", false, true);
    try {
      const decoded = await readPvo(file);
      if (!decoded.container || !decoded.manifest?.playback?.timelines?.length) {
        throw new Error("Choose a self-contained .pvo file exported by this editor.");
      }
      if (!decoded.validation.valid) throw new Error(decoded.validation.errors[0] || "The PVO manifest is invalid.");
      const nextLanguageSources = await readPvoLanguage(decoded);
      const languageValidation = validatePvo(decoded.manifest);
      if (!languageValidation.valid) throw new Error(languageValidation.errors[0] || "PVO language produced an invalid component.");
      adapters.destroyCustomOverlays();
      revokeAssetUrls();
      session.manifest = decoded.manifest;
      session.actionRuntime = adapters.makeActionRuntime(session.manifest);
      session.pvoLanguageSources = nextLanguageSources;
      session.captureMode = session.manifest.restyle_capture?.version === 1;
      session.assets = new Map(decoded.assets.map((asset) => [asset.id, asset]));
      decoded.assets.forEach((asset) => session.assetUrls.set(asset.id, URL.createObjectURL(asset.blob)));
      const ratio = session.manifest.canvas?.ratio || "16:9";
      const [width, height] = ratio.split(":").map(Number);
      refs.frame.style.aspectRatio = width > 0 && height > 0 ? `${width} / ${height}` : "16 / 9";
      refs.frame.style.setProperty("--aspect", width > 0 && height > 0 ? String(width / height) : String(16 / 9));
      refs.empty.hidden = true;
      refs.shell.hidden = false;
      await Promise.all([document.fonts.load('700 18px "Open Sauce Sans"'), document.fonts.load('400 18px "Peace Sans"')]);
      await adapters.restartExperience(autoplay);
      if (!autoplay) adapters.showControls();
      if (!refs.video.paused) adapters.setStatus("");
    } catch (error) {
      adapters.setStatus(`Could not open PVO · ${error.message}`, true);
      refs.empty.hidden = false;
    }
  }

  async function openPvoUrl(source, { autoplay = true } = {}) {
    try {
      const url = new URL(source, window.location.href);
      if (url.origin !== window.location.origin) throw new Error("The video must be hosted with this player.");
      adapters.setStatus("Loading…", false, true);
      const response = await fetch(url, { credentials: "omit", redirect: "error" });
      if (!response.ok) throw new Error(`Video could not be loaded (${response.status}).`);
      const blob = await response.blob();
      await openPvo(blob, { autoplay });
    } catch (error) {
      adapters.setStatus(error.message, true);
      refs.empty.hidden = false;
    }
  }

  return { openPvo, revokeAssetUrls, openPvoUrl };
}
