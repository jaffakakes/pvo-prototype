import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { readPvoProject } from "../../../../packages/pvo-sdk/index.js";
import { evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import { dur, locate, total } from "../../domain/clips/timing";
import { layerOrder, layerZ } from "../../domain/layers/order";
import type { Scene, Ratio } from "../../domain/project/model";
import { projectRatio } from "../../domain/project/ratio";
import { sceneDuration } from "../../domain/scenes/duration";
import type { CompletedExport } from "../../domain/publishing/model";
import { TextLayer } from "../text/TextLayer";
import { ComponentOverlay, componentVisible } from "../preview/ComponentOverlay";
import styles from "./ExportPreview.module.css";

export type ExportView = "setup" | "gate" | "picker" | "exporting" | "done" | "failed";

export function exportClock(seconds: number, tenths = true) {
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60);
  const whole = Math.floor(value % 60);
  return `${minutes}:${String(whole).padStart(2, "0")}${tenths ? `.${Math.floor(value * 10 % 10)}` : ""}`;
}

type Props = {
  scene: Scene;
  ratio: Ratio;
  mode: ExportView;
  pickerTime: number;
  onPickerTime(time: number): void;
  artifact: CompletedExport | null;
  artifactUrl: string | null;
};

/** A viewer owned by the export dialog, independent of the editor and render decoders. */
export function ExportPreview({ scene, ratio, mode, pickerTime, onPickerTime, artifact, artifactUrl }: Props) {
  const sourceVideo = useRef<HTMLVideoElement>(null);
  const resultVideo = useRef<HTMLVideoElement>(null);
  const picture = useRef<HTMLDivElement>(null);
  const clock = useRef(0);
  const playingRef = useRef(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [pictureSize, setPictureSize] = useState({ width: 0, height: 0 });
  const [pvoMediaUrl, setPvoMediaUrl] = useState<string | null>(null);
  const [resultReady, setResultReady] = useState(false);
  const duration = sceneDuration(scene);
  const [rw, rh] = projectRatio(ratio);
  const inResult = mode === "done" && resultReady;
  const interactiveResult = inResult && artifact?.format === "pvo";
  const shownTime = mode === "picker" ? pickerTime : time;
  const sourceTime = Math.min(shownTime, Math.max(0, duration - .001));
  const located = sourceTime < total(scene.clips) ? locate(sourceTime, scene.clips) : null;
  const clip = located?.c;
  const motion = evaluateAnimation(clip?.animation, located?.lt ?? 0);
  const scrubMax = Math.max(.1, duration);
  const seekPercent = Math.min(100, Math.max(0, shownTime / scrubMax * 100));
  const layers = useMemo(() => layerOrder(scene), [scene]);
  const visibleTexts = layers.flatMap(id => id.startsWith("text:")
    ? scene.texts.filter(item => id === `text:${item.id}` && shownTime >= item.start && shownTime < item.end) : []);
  const visibleComponents = scene.components.filter(component =>
    componentVisible(component, scene.clips, shownTime, null));
  const resultSource = mode === "done" ? artifact?.format === "pvo" ? pvoMediaUrl : artifactUrl : null;
  const cuts = scene.clips.reduce<number[]>((positions, item, index) => {
    const previous = positions.at(-1) ?? 0;
    if (index < scene.clips.length - 1) positions.push(previous + dur(item));
    return positions;
  }, []);

  useEffect(() => {
    const host = picture.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      setPictureSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (mode !== "picker") return;
    setPlaying(false);
    clock.current = Math.max(0, Math.min(duration, pickerTime));
    setTime(clock.current);
    const position = clock.current < total(scene.clips) ? locate(clock.current, scene.clips) : null;
    if (position && sourceVideo.current?.dataset.clipId === String(position.c.id))
      sourceVideo.current.currentTime = position.lt;
  }, [mode, pickerTime, duration, scene.clips]);

  useEffect(() => {
    if (mode === "exporting") setMuted(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== "gate") return;
    const phone = window.matchMedia("(max-width: 700px)");
    const stopHiddenPreview = () => {
      if (!phone.matches) return;
      setPlaying(false);
      setMuted(true);
    };
    stopHiddenPreview();
    phone.addEventListener("change", stopHiddenPreview);
    return () => phone.removeEventListener("change", stopHiddenPreview);
  }, [mode]);

  useEffect(() => {
    if (mode !== "done") return;
    setPlaying(false);
    clock.current = 0;
    setTime(0);
    setResultReady(false);
  }, [mode, artifact?.snapshotId]);

  useEffect(() => {
    if (mode !== "done" || artifact?.format !== "pvo") return;
    let current = true;
    let url: string | null = null;
    void readPvoProject(artifact.blob).then(packageData => {
      const main = packageData.manifest.scenes.find(item => item.id === packageData.manifest.initial_scene);
      const media = packageData.assets.find(item => item.id === main?.asset_id);
      if (!current || !media) return;
      url = URL.createObjectURL(media.blob);
      setPvoMediaUrl(url);
    }).catch(error => console.error("Could not preview exported PVO media:", error));
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
      setPvoMediaUrl(null);
    };
  }, [mode, artifact?.snapshotId]);

  useEffect(() => {
    const video = sourceVideo.current;
    if (!video) return;
    video.pause();
    if (!clip?.url) {
      video.removeAttribute("src");
      video.removeAttribute("data-clip-id");
      video.load();
      return;
    }
    video.dataset.clipId = String(clip.id);
    video.src = clip.url;
    video.defaultPlaybackRate = clip.speed;
    video.load();
    video.playbackRate = clip.speed;
    const ready = () => {
      const now = clock.current;
      const position = now < total(scene.clips) ? locate(now, scene.clips) : null;
      video.currentTime = position?.c.id === clip.id ? position.lt : clip.in;
      if (playingRef.current && mode !== "picker" && mode !== "done")
        void video.play().catch(() => setPlaying(false));
    };
    video.addEventListener("loadedmetadata", ready);
    return () => video.removeEventListener("loadedmetadata", ready);
  }, [clip?.id, clip?.url, scene]);

  useEffect(() => {
    playingRef.current = playing;
    const target = inResult ? resultVideo.current : sourceVideo.current;
    if (!target) return;
    if (playing && mode !== "picker" && (inResult || clip?.url))
      void target.play().catch(() => setPlaying(false));
    else target.pause();
  }, [playing, inResult, clip?.id, clip?.url, mode]);

  useEffect(() => {
    if (!playing || inResult || clip?.url || mode === "picker" || mode === "done") return;
    let previous = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      clock.current = Math.min(duration, clock.current + (now - previous) / 1000);
      previous = now;
      setTime(clock.current);
      if (clock.current >= duration) setPlaying(false);
    }, 50);
    return () => clearInterval(interval);
  }, [playing, inResult, clip?.url, mode, duration]);

  const seek = (next: number) => {
    const bounded = Math.max(0, Math.min(duration, next));
    clock.current = bounded;
    setTime(bounded);
    if (mode === "picker") onPickerTime(bounded);
    if (inResult && resultVideo.current && resultVideo.current.readyState >= 1)
      resultVideo.current.currentTime = bounded;
    else {
      const position = bounded < total(scene.clips) ? locate(bounded, scene.clips) : null;
      if (position && sourceVideo.current?.dataset.clipId === String(position.c.id)
        && sourceVideo.current.readyState >= 1)
        sourceVideo.current.currentTime = position.lt;
    }
  };
  const togglePlay = () => {
    if (mode === "picker") return;
    if (!playing && time >= duration - .02) seek(0);
    setPlaying(value => !value);
  };
  const sourcePosition = (video: HTMLVideoElement) => {
    if (!located || video.dataset.clipId !== String(located.c.id) || mode === "done" || mode === "picker") return;
    const next = located.start + Math.max(0, (video.currentTime - located.c.in) / located.c.speed);
    const boundary = located.start + located.d;
    clock.current = next >= boundary - .025 ? Math.min(duration, boundary + .001) : next;
    setTime(clock.current);
    if (clock.current >= duration - .01) setPlaying(false);
  };
  useEffect(() => {
    if (!playing || mode === "picker") return;
    let frame = 0;
    const update = () => {
      if (inResult && resultVideo.current) {
        clock.current = resultVideo.current.currentTime;
        setTime(clock.current);
      } else if (sourceVideo.current && clip?.url) sourcePosition(sourceVideo.current);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing, inResult, mode, clip?.id, clip?.url, clip?.in, clip?.speed, located?.start, located?.d, duration]);

  const textLayers = pictureSize.width > 0 && visibleTexts.map(item => <TextLayer key={item.id} overlay={item}
    width={pictureSize.width} height={pictureSize.height} zIndex={layerZ(scene, `text:${item.id}`)}
    selected={false} trying time={shownTime} />);
  const componentLayers = visibleComponents.map(component => <div key={component.id} className={styles.readOnlyComponent}>
    <ComponentOverlay component={component} width={pictureSize.width} zIndex={layerZ(scene, `component:${component.id}`)}
      selected={false} trying={false} time={shownTime} onResponse={() => undefined} />
  </div>);
  const videoMotion = {
    opacity: motion.opacity,
    transform: `translate(${motion.x}%, ${motion.y}%) rotate(${motion.rotation}deg) scale(${motion.scaleX}, ${motion.scaleY})`,
  };
  const slider = <div className={`${styles.sliderWrap} ${mode === "picker" ? styles.pickerSlider : ""}`}>
    <input type="range" min="0" max={scrubMax} step="0.01" value={Math.min(shownTime, scrubMax)}
      aria-label={mode === "picker" ? "Pick a cover frame" : "Scrub export preview"}
      aria-valuetext={exportClock(shownTime)}
      style={{ "--seek-pct": `${seekPercent}%` } as CSSProperties}
      onChange={event => seek(Number(event.currentTarget.value))} />
    <div className={styles.ticks} aria-hidden="true">{cuts.map((cut, index) =>
      <i key={index} style={{ left: `${cut / scrubMax * 100}%` }} />)}</div>
  </div>;

  return <div className={styles.well} data-export-preview data-state={mode}>
    <div className={styles.picture} ref={picture} style={{ aspectRatio: `${rw} / ${rh}` }}
      data-picker={mode === "picker"}>
      <div className={styles.sourceFrame} style={{ display: inResult ? "none" : undefined }}>
        <div className={styles.videoLayer} data-layer-id="video" style={{ zIndex: layerZ(scene, "video"), ...videoMotion,
          background: clip?.url ? "#000" : clip ? `linear-gradient(160deg, ${clip.color}, #15151c)` : "#000" }}>
          <video ref={sourceVideo} playsInline preload="metadata" muted={muted || !!clip?.audioDetached}
            className={styles.sourceVideo} style={{ visibility: clip?.url ? "visible" : "hidden",
              objectFit: clip?.fit ?? "contain",
              transform: `scale(${clip?.mirror ? -(clip.zoom ?? 1) : clip?.zoom ?? 1}, ${clip?.zoom ?? 1})` }}
            onTimeUpdate={event => sourcePosition(event.currentTarget)}
            onEnded={() => {
              if (!located) return;
              clock.current = Math.min(duration, located.start + located.d + .001);
              setTime(clock.current);
            }} />
        </div>
        {!inResult && textLayers}
        {!inResult && componentLayers}
      </div>
      {resultSource && <video ref={resultVideo} className={styles.resultVideo} src={resultSource}
        data-visible={inResult} playsInline muted={muted} preload="auto"
        style={interactiveResult ? { zIndex: layerZ(scene, "video"), background: "#000", ...videoMotion } : undefined}
        onLoadedData={() => { if (mode === "done") setResultReady(true); }}
        onTimeUpdate={event => {
          if (!inResult) return;
          clock.current = event.currentTarget.currentTime;
          setTime(clock.current);
        }} onEnded={() => setPlaying(false)} />}
      {interactiveResult && textLayers}
      {interactiveResult && componentLayers}
      <span className={`${styles.label} ${mode === "picker" ? styles.coverLabel : ""}`}>
        {mode === "picker" ? `COVER · ${exportClock(pickerTime)}` : inResult ? "✓ EXPORTED FILE" : "PREVIEW"}
      </span>
      {mode !== "picker" && <button type="button" className={styles.mobileMute}
        aria-label={muted ? "Unmute preview" : "Mute preview"} onClick={() => setMuted(value => !value)}>
        {muted ? "×" : "◖"}
      </button>}
    </div>
    <div className={styles.transport} data-picker={mode === "picker"}>
      {mode !== "picker" && <button type="button" className={styles.play} onClick={togglePlay}
        aria-label={playing ? "Pause export preview" : "Play export preview"}>{playing ? "Ⅱ" : "▶"}</button>}
      <span className={styles.time}>{exportClock(shownTime)} <small>/ {exportClock(duration)}</small></span>
      {slider}
      {mode !== "picker" && <button type="button" className={styles.desktopMute}
        onClick={() => setMuted(value => !value)} aria-label={muted ? "Unmute preview" : "Mute preview"}>
        {muted ? "MUTED" : "◖"}
      </button>}
      {mode === "picker" && <span className={styles.pickerEnd}>{exportClock(duration, false)}</span>}
    </div>
    <p className={styles.previewNote}>{mode === "picker" ? "Scrub to the frame you want for the cover."
      : mode === "exporting" ? "Preview only — the finished file plays here when ready."
        : mode === "gate" ? "Keep watching while you sign in — nothing is lost."
        : inResult ? "Playing the exported file — what viewers will get."
          : "Project preview at the export aspect ratio."}</p>
  </div>;
}
