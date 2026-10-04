import { locate, total } from "../../domain/clips/timing";
import { componentEnd } from "../../domain/components/timing";
import { layerOrder } from "../../domain/layers/order";
import type { Clip, Ratio, Scene } from "../../domain/project/model";
import { projectRatio } from "../../domain/project/ratio";
import { sceneDuration } from "../../domain/scenes/duration";
import { drawSceneFrame } from "../../infrastructure/media/drawSceneFrame";
import { createFontScope } from "../../../../packages/pvo-fonts/index.js";
import { paintCoverComponent } from "./paintCoverComponent";

function waitForVideo(video: HTMLVideoElement, eventName: "loadeddata" | "seeked", signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("The cover frame could not be read.")), 12_000);
    function finish(error?: Error) {
      clearTimeout(timer);
      video.removeEventListener(eventName, ready);
      video.removeEventListener("error", failed);
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    }
    function ready() { finish(); }
    function failed() { finish(new Error("The cover video could not be read.")); }
    function aborted() { finish(new DOMException("Cancelled", "AbortError")); }
    video.addEventListener(eventName, ready, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

function blackTail(length: number, width: number, height: number): Clip {
  return { id: -1, url: null, color: "#000000", srcDur: length, in: 0, out: length,
    speed: 1, zoom: 1, mirror: false, width, height, fit: "contain" };
}

/** Capture the selected frame with the visible visual layers in their authored stack order. */
export async function captureCoverFrame(scene: Scene, ratio: Ratio, at: number, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  const [rw, rh] = projectRatio(ratio);
  const short = 1080;
  const width = rw <= rh ? short : Math.round(short * rw / rh / 2) * 2;
  const height = rw <= rh ? Math.round(short * rh / rw / 2) * 2 : short;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The cover image could not be prepared.");
  const duration = sceneDuration(scene);
  const time = Math.max(0, Math.min(at, Math.max(0, duration - .01)));
  const position = time < total(scene.clips) ? locate(time, scene.clips) : null;
  const clip = position?.c ?? blackTail(Math.max(.01, duration - total(scene.clips)), width, height);
  const order = layerOrder(scene);
  const components = new Map<string, Scene["components"][number]>(scene.components.map(component => [`component:${component.id}`, component]));
  const video = clip.url ? document.createElement("video") : null;
  const fonts = createFontScope();
  try {
    await Promise.all([
      ...scene.texts.map(text => text.style?.fontAsset ? fonts.load(text.style.fontAsset) : undefined),
      ...scene.components.map(component => component.font && !component.code?.custom ? fonts.load(component.font) : undefined),
    ]);
    await document.fonts.ready;
    signal?.throwIfAborted();
    if (video && clip.url) {
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = clip.url;
      video.load();
      await waitForVideo(video, "loadeddata", signal);
      const local = Math.min(clip.out - .005, position?.lt ?? clip.in);
      if (local > .01) {
        const sought = waitForVideo(video, "seeked", signal);
        video.currentTime = local;
        await sought;
      }
    }
    signal?.throwIfAborted();
    drawSceneFrame(context, width, height, {
      clip, video, sourceTime: position?.lt ?? 0, time, texts: scene.texts, layers: order,
      paintAdditionalLayer(id) {
        const component = components.get(id);
        if (component && time >= component.at && time < componentEnd(component, scene.clips))
          paintCoverComponent(context, width, height, component, time);
      },
    });
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", .9));
    if (!blob || !blob.size || blob.type !== "image/webp")
      throw new Error("This browser could not create the cover image.");
    return blob;
  } finally {
    fonts.dispose();
    video?.pause();
    video?.removeAttribute("src");
    video?.load();
  }
}
