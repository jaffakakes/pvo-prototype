import { evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import { drawText } from "../../../../packages/pvo-text-runtime/index.js";
import type { Clip, TextOverlay } from "../../domain/project/model";

const clipCanvases = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();

/** Draw the clip's complete visual layer around the same centre as the preview. */
function drawVideoLayer(
  context: CanvasRenderingContext2D, width: number, height: number,
  clip: Clip | null, video: HTMLVideoElement | null, sourceTime: number,
) {
  const motion = evaluateAnimation(clip?.animation, sourceTime);
  let canvas = clipCanvases.get(context);
  if (!canvas) {
    canvas = document.createElement("canvas");
    clipCanvases.set(context, canvas);
  }
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const layer = canvas.getContext("2d");
  if (!layer) throw new Error("Could not draw the animated video layer.");
  layer.fillStyle = "#000";
  layer.fillRect(0, 0, width, height);
  layer.save();
  if (clip && video?.videoWidth) {
    const fit = clip.fit === "cover" ? Math.max : Math.min;
    const scale = fit(width / video.videoWidth, height / video.videoHeight) * clip.zoom;
    const w = video.videoWidth * scale, h = video.videoHeight * scale;
    if (clip.mirror) {
      layer.translate(width, 0);
      layer.scale(-1, 1);
    }
    layer.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
  } else if (clip) {
    const gradient = layer.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, clip.color);
    gradient.addColorStop(1, clip.id === -1 ? "#000" : "#15151C");
    layer.fillStyle = gradient;
    layer.fillRect(0, 0, width, height);
  }
  layer.restore();
  // Composite the whole source once so opacity reveals lower layers uniformly,
  // including through letterboxing; drawing matte and footage separately would double alpha.
  context.save();
  context.globalAlpha = motion.opacity;
  context.translate(width * (.5 + motion.x / 100), height * (.5 + motion.y / 100));
  context.rotate(motion.rotation * Math.PI / 180);
  context.scale(motion.scaleX, motion.scaleY);
  context.drawImage(canvas, -width / 2, -height / 2, width, height);
  context.restore();
}

/** Export and AI frame inspection use one ordered, time-aware native painter. */
export function drawSceneFrame(
  context: CanvasRenderingContext2D, width: number, height: number,
  input: { clip: Clip | null; video: HTMLVideoElement | null; sourceTime: number;
    time: number; texts: TextOverlay[]; layers: string[]; includeText?: boolean; includeVideoAnimation?: boolean;
    paintAdditionalLayer?: (id: string) => void },
) {
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  for (const id of input.layers) {
    if (id === "video") {
      drawVideoLayer(context, width, height, input.includeVideoAnimation === false && input.clip
        ? { ...input.clip, animation: undefined } : input.clip, input.video, input.sourceTime);
      continue;
    }
    const text = input.texts.find(item => id === `text:${item.id}`);
    if (text && input.includeText !== false && input.time >= text.start && input.time < text.end)
      drawText(context, width, height, text, input.time - text.start);
    if (!text) input.paintAdditionalLayer?.(id);
  }
}
