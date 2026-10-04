import { createFontScope } from "../../../../packages/pvo-fonts/index.js";
import { evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import { drawSceneFrame } from "./drawSceneFrame";
import { sceneDuration } from "../../domain/scenes/duration";
import { exportFrameSize } from "../../domain/export/quality";
import { createAudioLayerPlayer } from "../audio/audioLayerPlayer";
import { dur, total } from "../../domain/clips/timing";
import { layerOrder } from "../../domain/layers/order";
import type { Clip, Ratio, Scene } from "../../domain/project/model";
import type { ExportQuality } from "../../domain/publishing/model";
import { clamp } from "../../domain/project/numbers";
import { startSound } from "../audio/sound";
import { audioGain } from "../../domain/audio/gain";

export type ExportResult = {
  blob: Blob;
  url: string;
  name: string;
};
export type VideoExportSource = Pick<Scene, "clips" | "texts" | "components" | "layers" | "muted" | "sound" | "audioClips" | "musicGain" | "clipGain" | "musicAnimation"> & {
  ratio: Ratio;
  quality: ExportQuality;
  includeText?: boolean;
  includeVideoAnimation?: boolean;
};
function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("Cancelled", "AbortError");
}
function until<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener("abort", aborted); reject(abortReason(signal)); };
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    promise.then(
      value => { signal.removeEventListener("abort", aborted); resolve(value); },
      error => { signal.removeEventListener("abort", aborted); reject(error); },
    );
  });
}
function waitFor(video: HTMLVideoElement, event: keyof HTMLMediaElementEventMap, ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const timer = window.setTimeout(() => { cleanup(); reject(new Error(`Video ${event} timed out`)); }, ms);
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("Video could not be read")); };
    const aborted = () => { cleanup(); reject(abortReason(signal!)); };
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener("error", fail);
      signal?.removeEventListener("abort", aborted); };
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", fail, { once: true });
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}
function waitForRecorder(recorder: MediaRecorder, event: "pause" | "resume" | "stop", signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const done = () => { cleanup(); resolve(); };
    const aborted = () => { cleanup(); reject(abortReason(signal!)); };
    const cleanup = () => { recorder.removeEventListener(event, done); signal?.removeEventListener("abort", aborted); };
    recorder.addEventListener(event, done, { once: true });
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}
function frames(step: () => boolean, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    let frame = 0;
    const cleanup = () => { cancelAnimationFrame(frame); signal?.removeEventListener("abort", aborted); };
    const aborted = () => { cleanup(); reject(abortReason(signal!)); };
    const tick = () => {
      try {
        signal?.throwIfAborted();
        const complete = step();
        signal?.throwIfAborted();
        if (complete) { cleanup(); resolve(); }
        else frame = requestAnimationFrame(tick);
      } catch (error) { cleanup(); reject(error); }
    };
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
    else frame = requestAnimationFrame(tick);
  });
}
function createRecorder(stream: MediaStream, types: string[], videoBitsPerSecond: number) {
  let lastError: unknown;
  for (const mimeType of [...types.filter(type => MediaRecorder.isTypeSupported(type)), null]) {
    const options: MediaRecorderOptions[] = mimeType
      ? [{ mimeType, videoBitsPerSecond }, { mimeType }]
      : [{ videoBitsPerSecond }, {}];
    for (const option of options) {
      try {
        return { recorder: new MediaRecorder(stream, option), requestedType: mimeType };
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw new Error("This browser could not start export recording.", { cause: lastError });
}
export async function exportVideo(state: VideoExportSource, onPct: (progress: number) => void, signal?: AbortSignal): Promise<ExportResult> {
  const fonts = createFontScope();
  try {
    if (state.includeText !== false) await Promise.all(state.texts.map(text => text.style?.fontAsset ? fonts.load(text.style.fontAsset) : undefined));
    return await renderVideo(state, onPct, signal);
  } finally {
    fonts.dispose();
  }
}

async function renderVideo(state: VideoExportSource, onPct: (progress: number) => void, signal?: AbortSignal): Promise<ExportResult> {
  await until(document.fonts.ready, signal);
  signal?.throwIfAborted();
  const layers = layerOrder(state);
  const draw = (context: CanvasRenderingContext2D, width: number, height: number, clip: Clip,
    source: HTMLVideoElement | null, time: number, sourceTime: number) => drawSceneFrame(context, width, height, {
      clip, video: source, time, sourceTime, texts: state.texts, layers, includeText: state.includeText, includeVideoAnimation: state.includeVideoAnimation,
    });
  const { width, height } = exportFrameSize(state.ratio, state.quality);
  const videoBitsPerSecond = state.quality === "4K" ? 35_000_000 : state.quality === "1080p" ? 12_000_000 : 6_000_000;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || !canvas.captureStream || !window.MediaRecorder)
    throw new Error("Export isn't supported in this browser");
  const stream = canvas.captureStream(30);
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  let audio: AudioContext | null = null;
  let mixed: MediaStreamAudioDestinationNode | null = null;
  let music: AudioBufferSourceNode | null = null;
  let silence: OscillatorNode | null = null;
  let originalGain: GainNode | null = null;
  let musicGain: GainNode | null = null;
  let audioError: Error | null = null;
  let layersPlayer: ReturnType<typeof createAudioLayerPlayer> | null = null;
  const audioClips = state.audioClips ?? [];
  const needsClipAudio = !state.muted && state.clips.some(clip => Boolean(clip.url) && !clip.audioDetached);
  if (needsClipAudio || state.sound > 0 || audioClips.length > 0) {
    try {
      audio = new AudioContext();
      mixed = audio.createMediaStreamDestination();
      if (needsClipAudio) {
        originalGain = audio.createGain();
        audio.createMediaElementSource(video).connect(originalGain).connect(mixed);
      } else
        video.muted = true;
      // Keep the audio track producing samples even for silent source frames.
      // Chrome otherwise occasionally returns an empty video Blob.
      const zeroGain = audio.createGain();
      zeroGain.gain.value = 0;
      silence = audio.createOscillator();
      silence.connect(zeroGain).connect(mixed);
      silence.start();
      mixed.stream.getAudioTracks().forEach(track => stream.addTrack(track));
      await until(audio.resume(), signal);
    }
    catch {
      silence?.stop();
      silence = null;
      void audio?.close();
      audio = null;
      mixed = null;
      video.muted = true;
      if (signal?.aborted) {
        stream.getTracks().forEach(track => track.stop());
        throw abortReason(signal);
      }
    }
  }
  else
    video.muted = true;
  // WebKit's VP9 shifts canvas colours, so prefer H.264 MP4 there. Chrome's
  // MediaRecorder MP4 path dropped many frames in the export diagnostic; keep
  // its WebM preference until that encoder can preserve the authored timeline.
  const webkit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
  const mp4 = stream.getAudioTracks().length
    ? "video/mp4;codecs=avc1.42E01E,mp4a.40.2"
    : "video/mp4;codecs=avc1.42E01E";
  const webm = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  const preferred = webkit ? [mp4, "video/mp4", ...webm] : [...webm, mp4, "video/mp4"];
  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];
  const duration = sceneDuration(state);
  const renderClips = [...state.clips];
  const tail = duration - total(state.clips);
  if (tail > .001) renderClips.push({ id: -1, url: null, color: "#000", srcDur: tail,
    in: 0, out: tail, speed: 1, zoom: 1, mirror: false, width, height, fit: "contain" });
  let elapsed = 0;
  let startedRecorder = false;
  try {
    const selected = createRecorder(stream, preferred, videoBitsPerSecond);
    recorder = selected.recorder;
    const activeRecorder = recorder;
    activeRecorder.ondataavailable = event => {
      if (event.data.size)
        chunks.push(event.data);
    };
    if (audioClips.length) {
      if (!audio || !mixed) throw new Error("Could not initialize extracted audio for export.");
      layersPlayer = createAudioLayerPlayer(error => { audioError = error; }, { context: audio, destination: mixed });
      await until(layersPlayer.prepare(audioClips), signal);
    }
    for (const clip of renderClips) {
      signal?.throwIfAborted();
      if (originalGain) originalGain.gain.value = clip.audioDetached ? 0
        : audioGain(audioGain(state.clipGain) * evaluateAnimation(clip.animation, clip.in).gain);
      const length = dur(clip);
      if (startedRecorder) {
        const paused = waitForRecorder(activeRecorder, "pause", signal);
        activeRecorder.pause();
        await paused;
        if (audio) await until(audio.suspend(), signal);
      }
      let source: HTMLVideoElement | null = null;
      if (clip.url) {
        video.src = clip.url;
        video.load();
        await waitFor(video, "loadeddata", 10000, signal);
        video.currentTime = clip.in;
        if (clip.in > .01)
          await waitFor(video, "seeked", 5000, signal);
        video.playbackRate = clamp(clip.speed, .25, 4);
        source = video;
      }
      // Decode before recording so media startup does not become an encoded hold.
      if (source) await until(video.play(), signal);
      draw(ctx, width, height, clip, source, elapsed, clip.in);
      if (!startedRecorder) {
        activeRecorder.start();
        startedRecorder = true;
        // The generated soundtrack starts only when encoded video begins.
        if (audio && mixed && state.sound > 0) {
          musicGain = audio.createGain();
          musicGain.gain.value = audioGain(audioGain(state.musicGain) * evaluateAnimation(state.musicAnimation, 0).gain);
          musicGain.connect(mixed);
          music = startSound(audio, state.sound, musicGain, 1);
        }
      }
      else {
        if (audio) await until(audio.resume(), signal);
        const resumed = waitForRecorder(activeRecorder, "resume", signal);
        activeRecorder.resume();
        await resumed;
      }
      layersPlayer?.sync(audioClips, elapsed, true);
      const started = performance.now();
      await frames(() => {
        if (audioError) throw audioError;
        const local = source ? clamp((source.currentTime - clip.in) / clip.speed, 0, length) : clamp((performance.now() - started) / 1000, 0, length);
        const t = elapsed + local;
        layersPlayer?.sync(audioClips, t, true);
        const sourceTime = clip.in + local * clip.speed;
        if (originalGain) originalGain.gain.value = clip.audioDetached ? 0
          : audioGain(audioGain(state.clipGain) * evaluateAnimation(clip.animation, sourceTime).gain);
        if (musicGain) musicGain.gain.value = audioGain(audioGain(state.musicGain) * evaluateAnimation(state.musicAnimation, t).gain);
        draw(ctx, width, height, clip, source, t, sourceTime);
        onPct(clamp(t / duration, 0, 1));
        return local >= length - .025 || (!!source && source.ended) || performance.now() - started > (length + 5) * 1000;
      }, signal);
      video.pause();
      layersPlayer?.pause();
      elapsed += length;
    }
    onPct(1);
    const stopped = waitForRecorder(activeRecorder, "stop", signal);
    activeRecorder.stop();
    await stopped;
    const mime = activeRecorder.mimeType || selected.requestedType || "video/webm";
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size)
      throw new Error("The video file was empty");
    return { blob, url: URL.createObjectURL(blob), name: `restyle-video.${mime.includes("mp4") ? "mp4" : "webm"}` };
  }
  catch (error) {
    if (recorder && recorder.state !== "inactive")
      recorder.stop();
    throw error;
  }
  finally {
    layersPlayer?.dispose();
    video.pause();
    video.removeAttribute("src");
    video.load();
    music?.stop();
    musicGain?.disconnect();
    silence?.stop();
    await audio?.close();
    stream.getTracks().forEach(track => track.stop());
  }
}
