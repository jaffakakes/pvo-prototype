import { clamp } from "./format";
import { dur, total } from "./timeline";
import { startSound } from "./sound";
import { FX, RATIOS, TEXT_COLORS } from "../store";
import type { CaptureState, Clip, TextOverlay } from "../store";

export type ExportResult = { url: string; name: string };

function waitFor(video: HTMLVideoElement, event: keyof HTMLMediaElementEventMap, ms: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { cleanup(); reject(new Error(`Video ${event} timed out`)); }, ms);
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("Video could not be read")); };
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener("error", fail); };
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", fail, { once: true });
  });
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function draw(ctx: CanvasRenderingContext2D, width: number, height: number, clip: Clip, video: HTMLVideoElement | null, t: number, texts: TextOverlay[]) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.filter = FX[clip.fx].css;
  if (video?.videoWidth) {
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight) * clip.zoom;
    const w = video.videoWidth * scale, h = video.videoHeight * scale;
    if (clip.mirror) { ctx.translate(width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, clip.color); gradient.addColorStop(1, "#15151C");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
  for (const overlay of texts) {
    if (t < overlay.start || t > overlay.end) continue;
    const palette = TEXT_COLORS[overlay.color];
    const font = width * .073, unit = width / 247;
    ctx.font = `${font}px 'Peace Sans', 'Arial Black', sans-serif`;
    const w = ctx.measureText(overlay.text).width + font * 1.3;
    const h = font * 1.55;
    const x = width * overlay.x / 100 - w / 2;
    const y = height * overlay.y / 100 - h / 2;
    ctx.fillStyle = "#000"; rounded(ctx, x + 3 * unit, y + 3 * unit, w, h, 10 * unit); ctx.fill();
    ctx.fillStyle = palette.bg; rounded(ctx, x, y, w, h, 10 * unit); ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 2.5 * unit; ctx.stroke();
    ctx.fillStyle = palette.fg; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(overlay.text, x + w / 2, y + h / 2);
  }
}

function frames(step: () => boolean) {
  return new Promise<void>(resolve => {
    const tick = () => { if (step()) resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}

export async function exportVideo(state: CaptureState, onPct: (progress: number) => void): Promise<ExportResult> {
  const [rw, rh] = RATIOS[state.ratio];
  const short = state.quality === "1080p" ? 1080 : 720;
  const width = rw <= rh ? short : Math.round(short * rw / rh / 2) * 2;
  const height = rw <= rh ? Math.round(short * rh / rw / 2) * 2 : short;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || !canvas.captureStream || !window.MediaRecorder) throw new Error("Export isn't supported in this browser");
  const stream = canvas.captureStream(30);
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  let audio: AudioContext | null = null;
  let music: AudioBufferSourceNode | null = null;
  try {
    audio = new AudioContext();
    const mixed = audio.createMediaStreamDestination();
    if (!state.muted) audio.createMediaElementSource(video).connect(mixed);
    else video.muted = true;
    if (state.sound > 0) music = startSound(audio, state.sound, mixed);
    mixed.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    await audio.resume();
  } catch { audio = null; video.muted = true; }
  const preferred = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.start(100);
  const duration = total(state.clips);
  let elapsed = 0;
  try {
    for (const clip of state.clips) {
      const length = dur(clip);
      const started = performance.now();
      let source: HTMLVideoElement | null = null;
      if (clip.url) {
        video.src = clip.url;
        video.load();
        await waitFor(video, "loadeddata", 10000);
        video.currentTime = clip.in;
        if (clip.in > .01) await waitFor(video, "seeked", 5000);
        video.playbackRate = clamp(clip.speed, .25, 4);
        await video.play();
        source = video;
      }
      await frames(() => {
        const local = source ? clamp((source.currentTime - clip.in) / clip.speed, 0, length) : clamp((performance.now() - started) / 1000, 0, length);
        const t = elapsed + local;
        draw(ctx, width, height, clip, source, t, state.texts);
        onPct(clamp(t / duration, 0, 1));
        return local >= length - .025 || (!!source && source.ended) || performance.now() - started > (length + 5) * 1000;
      });
      video.pause();
      elapsed += length;
    }
    onPct(1);
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.stop();
    await stopped;
    const mime = recorder.mimeType || preferred || "video/webm";
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) throw new Error("The video file was empty");
    return { url: URL.createObjectURL(blob), name: `restyle-video.${mime.includes("mp4") ? "mp4" : "webm"}` };
  } catch (error) {
    if (recorder.state !== "inactive") recorder.stop();
    throw error;
  } finally {
    music?.stop();
    await audio?.close();
    stream.getTracks().forEach(track => track.stop());
  }
}
