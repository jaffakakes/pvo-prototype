import { createFontScope } from "../../packages/pvo-fonts/index.js";
import { restoreManifestFonts } from "../../packages/pvo-fonts/portable.js";
import { readPvo, validatePvo } from "../../packages/pvo-sdk/index.js";
import { readPvoLanguage } from "../components/language.js";
import {
  clearResponseProgress,
  invalidateActionOperations,
  invalidatePlaybackNavigation,
} from "../actions/operations.js";
import { clearRequestStatus, updateRequestStatus } from "../actions/request-status.js";

export function createProjectLoader({ session, refs, adapters }) {
  let fontScope = null;
  function revokeAssetUrls() {
    fontScope?.dispose();
    fontScope = null;
    session.assetUrls.forEach((url) => URL.revokeObjectURL(url));
    session.assetUrls = new Map();
  }

  function beginProjectLoad() {
    session.projectLoadController?.abort();
    const operation = {
      id: ++session.projectLoadSequence,
      controller: new AbortController(),
    };
    session.projectLoadController = operation.controller;
    invalidatePlaybackNavigation(session);
    invalidateActionOperations(session);
    clearResponseProgress(session);
    clearRequestStatus(session);
    // Detach the old runtime immediately; a late Promise may mutate it, but can
    // no longer affect the replacement project or render into this session.
    session.actionRuntime = null;
    return operation;
  }

  const projectLoadIsCurrent = (operation) => operation.id === session.projectLoadSequence
    && operation.controller === session.projectLoadController
    && !operation.controller.signal.aborted;

  async function loadPvo(file, { autoplay = false } = {}, operation) {
    adapters.setStatus("Loading…", false, true);
    const nextFonts = createFontScope();
    let adoptedFonts = false;
    try {
      const decoded = await readPvo(file);
      if (!projectLoadIsCurrent(operation)) return;
      if (!decoded.container || !decoded.manifest?.playback?.timelines?.length) {
        throw new Error("Choose a self-contained .pvo file exported by this editor.");
      }
      if (!decoded.validation.valid) throw new Error(decoded.validation.errors[0] || "The PVO manifest is invalid.");
      const fonts = await restoreManifestFonts(decoded);
      if (!projectLoadIsCurrent(operation)) return;
      await Promise.all(fonts.map(font => nextFonts.load(font)));
      if (!projectLoadIsCurrent(operation)) return;
      const nextLanguageSources = await readPvoLanguage(decoded);
      if (!projectLoadIsCurrent(operation)) return;
      const languageValidation = validatePvo(decoded.manifest);
      if (!languageValidation.valid) throw new Error(languageValidation.errors[0] || "PVO language produced an invalid component.");
      adapters.destroyCustomOverlays();
      revokeAssetUrls();
      fontScope = nextFonts;
      adoptedFonts = true;
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
      if (!projectLoadIsCurrent(operation)) return;
      await adapters.restartExperience(autoplay);
      if (!projectLoadIsCurrent(operation)) return;
      if (!autoplay) adapters.showControls();
      updateRequestStatus(session, adapters.setStatus);
    } catch (error) {
      if (!projectLoadIsCurrent(operation)) return;
      adapters.setStatus(`Could not open PVO · ${error.message}`, true);
      refs.empty.hidden = false;
    } finally {
      if (!adoptedFonts) nextFonts.dispose();
    }
  }

  async function openPvo(file, options = {}) {
    if (!file) return;
    return loadPvo(file, options, beginProjectLoad());
  }

  async function openPvoUrl(source, { autoplay = true } = {}) {
    const operation = beginProjectLoad();
    try {
      const url = new URL(source, window.location.href);
      if (url.origin !== window.location.origin) throw new Error("The video must be hosted with this player.");
      adapters.setStatus("Loading…", false, true);
      const response = await fetch(url, {
        credentials: "omit",
        redirect: "error",
        signal: operation.controller.signal,
      });
      if (!projectLoadIsCurrent(operation)) return;
      if (!response.ok) throw new Error(`Video could not be loaded (${response.status}).`);
      const blob = await response.blob();
      if (!projectLoadIsCurrent(operation)) return;
      await loadPvo(blob, { autoplay }, operation);
    } catch (error) {
      if (!projectLoadIsCurrent(operation)) return;
      adapters.setStatus(error.message, true);
      refs.empty.hidden = false;
    }
  }

  return { openPvo, revokeAssetUrls, openPvoUrl };
}
