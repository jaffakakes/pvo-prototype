import { evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import { drawSceneFrame } from "./drawSceneFrame";
import { sceneDuration } from "../../domain/scenes/duration";
import { createAudioLayerPlayer } from "../audio/audioLayerPlayer";
import { dur, total } from "../../domain/clips/timing";
import { layerOrder } from "../../domain/layers/order";
import type { Clip, Ratio, Scene } from "../../domain/project/model";
import { clamp } from "../../domain/project/numbers";
import { projectRatio } from "../../domain/project/ratio";
import { startSound } from "../audio/sound";
import { audioGain } from "../../domain/audio/gain";

export type ExportResult = {
  blob: Blob;
  url: string;
  name: string;
};
export type VideoExportSource = Pick<Scene, "clips" | "texts" | "components" | "layers" | "muted" | "sound" | "audioClips" | "musicGain" | "clipGain" | "musicAnimation"> & {
  ratio: Ratio;
  quality: "720p" | "1080p";
  includeText?: boolean;
  includeVideoAnimation?: boolean;
};
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
function frames(step: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    const tick = () => {
      try {
        if (step()) resolve();
        else requestAnimationFrame(tick);
      } catch (error) { reject(error); }
    };
    requestAnimationFrame(tick);
  });
}
export async function exportVideo(state: VideoExportSource, onPct: (progress: number) => void): Promise<ExportResult> {
  await document.fonts.ready;
  const layers = layerOrder(state);
  const draw = (context: CanvasRenderingContext2D, width: number, height: number, clip: Clip,
    source: HTMLVideoElement | null, time: number, sourceTime: number) => drawSceneFrame(context, width, height, {
      clip, video: source, time, sourceTime, texts: state.texts, layers, includeText: state.includeText, includeVideoAnimation: state.includeVideoAnimation,
    });
  const [rw, rh] = projectRatio(state.ratio);
  const short = state.quality === "1080p" ? 1080 : 720;
  const width = rw <= rh ? short : Math.round(short * rw / rh / 2) * 2;
  const height = rw <= rh ? Math.round(short * rh / rw / 2) * 2 : short;
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
      await audio.resume();
    }
    catch {
      silence?.stop();
      silence = null;
      void audio?.close();
      audio = null;
      mixed = null;
      video.muted = true;
    }
  }
  else
    video.muted = true;
  const preferred = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => {
    if (event.data.size)
      chunks.push(event.data);
  };
  const duration = sceneDuration(state);
  const renderClips = [...state.clips];
  const tail = duration - total(state.clips);
  if (tail > .001) renderClips.push({ id: -1, url: null, color: "#000", srcDur: tail,
    in: 0, out: tail, speed: 1, zoom: 1, mirror: false, width, height, fit: "contain" });
  let elapsed = 0;
  let startedRecorder = false;
  try {
    if (audioClips.length) {
      if (!audio || !mixed) throw new Error("Could not initialize extracted audio for export.");
      layersPlayer = createAudioLayerPlayer(error => { audioError = error; }, { context: audio, destination: mixed });
      await layersPlayer.prepare(audioClips);
    }
    for (const clip of renderClips) {
      if (originalGain) originalGain.gain.value = clip.audioDetached ? 0
        : audioGain(audioGain(state.clipGain) * evaluateAnimation(clip.animation, clip.in).gain);
      const length = dur(clip);
      if (startedRecorder) {
        const paused = new Promise<void>(resolve => recorder.addEventListener("pause", () => resolve(), { once: true }));
        recorder.pause();
        await paused;
        await audio?.suspend();
      }
      let source: HTMLVideoElement | null = null;
      if (clip.url) {
        video.src = clip.url;
        video.load();
        await waitFor(video, "loadeddata", 10000);
        video.currentTime = clip.in;
        if (clip.in > .01)
          await waitFor(video, "seeked", 5000);
        video.playbackRate = clamp(clip.speed, .25, 4);
        source = video;
      }
      // Prepare a real first frame before recording or resuming. Metadata/seek waits
      // happen while MediaRecorder is stopped/paused, so they cannot create black gaps.
      draw(ctx, width, height, clip, source, elapsed, clip.in);
      if (!startedRecorder) {
        recorder.start(100);
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
        await audio?.resume();
        const resumed = new Promise<void>(resolve => recorder.addEventListener("resume", () => resolve(), { once: true }));
        recorder.resume();
        await resumed;
      }
      if (source)
        await video.play();
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
      });
      video.pause();
      layersPlayer?.pause();
      elapsed += length;
    }
    onPct(1);
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.stop();
    await stopped;
    const mime = recorder.mimeType || preferred || "video/webm";
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size)
      throw new Error("The video file was empty");
    return { blob, url: URL.createObjectURL(blob), name: `restyle-video.${mime.includes("mp4") ? "mp4" : "webm"}` };
  }
  catch (error) {
    if (recorder.state !== "inactive")
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
