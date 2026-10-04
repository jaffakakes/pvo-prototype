import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import { dur } from "../../domain/clips/timing";
import { layerOrder, layerZ } from "../../domain/layers/order";
import type { Scene, Ratio } from "../../domain/project/model";
import { projectRatio } from "../../domain/project/ratio";
import type { CompletedExport } from "../../domain/publishing/model";
import { TextLayer } from "../text/TextLayer";
import { ComponentOverlay } from "../preview/ComponentOverlay";
import { componentVisible } from "../../domain/components/presentation";
import styles from "./ExportPreview.module.css";

import { exportClock, type ExportView } from "./presentation";
import { useExportPreviewPlayback } from "./useExportPreviewPlayback";
import { useExportMediaUrl } from "./useExportPreviewUrls";

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
export function ExportPreview({
  scene,
  ratio,
  mode,
  pickerTime,
  onPickerTime,
  artifact,
  artifactUrl,
}: Props) {
  const picture = useRef<HTMLDivElement>(null);
  const [pictureSize, setPictureSize] = useState({ width: 0, height: 0 });
  const playback = useExportPreviewPlayback({
    scene,
    mode,
    pickerTime,
    onPickerTime,
    artifactId: artifact?.snapshotId,
  });
  const {
    sourceVideo,
    resultVideo,
    clip,
    located,
    duration,
    shownTime,
    inResult,
    playing,
    muted,
    seek,
    togglePlay,
    sourcePosition,
    sourceEnded,
    resultPosition,
    resultLoaded,
    stop,
    toggleMuted,
  } = playback;
  const resultSource = useExportMediaUrl(
    mode === "done" ? artifact : null,
    artifactUrl,
  );
  const [rw, rh] = projectRatio(ratio);
  const interactiveResult = inResult && artifact?.format === "pvo";
  const motion = evaluateAnimation(clip?.animation, located?.lt ?? 0);
  const scrubMax = Math.max(0.1, duration);
  const seekPercent = Math.min(100, Math.max(0, (shownTime / scrubMax) * 100));
  const layers = useMemo(() => layerOrder(scene), [scene]);
  const visibleTexts = layers.flatMap((id) =>
    id.startsWith("text:")
      ? scene.texts.filter(
          (item) =>
            id === `text:${item.id}` &&
            shownTime >= item.start &&
            shownTime < item.end,
        )
      : [],
  );
  const visibleComponents = scene.components.filter((component) =>
    componentVisible(component, scene.clips, shownTime, null),
  );
  const cuts = scene.clips.reduce<number[]>((positions, item, index) => {
    const previous = positions.at(-1) ?? 0;
    if (index < scene.clips.length - 1) positions.push(previous + dur(item));
    return positions;
  }, []);

  useEffect(() => {
    const host = picture.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      setPictureSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const textLayers =
    pictureSize.width > 0 &&
    visibleTexts.map((item) => (
      <TextLayer
        key={item.id}
        overlay={item}
        width={pictureSize.width}
        height={pictureSize.height}
        zIndex={layerZ(scene, `text:${item.id}`)}
        selected={false}
        trying
        time={shownTime}
      />
    ));
  const componentLayers = visibleComponents.map((component) => (
    <div key={component.id} className={styles.readOnlyComponent}>
      <ComponentOverlay
        component={component}
        width={pictureSize.width}
        zIndex={layerZ(scene, `component:${component.id}`)}
        selected={false}
        trying={false}
        time={shownTime}
        onResponse={() => undefined}
      />
    </div>
  ));
  const videoMotion = {
    opacity: motion.opacity,
    transform: `translate(${motion.x}%, ${motion.y}%) rotate(${motion.rotation}deg) scale(${motion.scaleX}, ${motion.scaleY})`,
  };
  const slider = (
    <div
      className={`${styles.sliderWrap} ${mode === "picker" ? styles.pickerSlider : ""}`}
    >
      <input
        type="range"
        min="0"
        max={scrubMax}
        step="0.01"
        value={Math.min(shownTime, scrubMax)}
        aria-label={
          mode === "picker" ? "Pick a cover frame" : "Scrub export preview"
        }
        aria-valuetext={exportClock(shownTime)}
        style={{ "--seek-pct": `${seekPercent}%` } as CSSProperties}
        onChange={(event) => seek(Number(event.currentTarget.value))}
      />
      <div className={styles.ticks} aria-hidden="true">
        {cuts.map((cut, index) => (
          <i key={index} style={{ left: `${(cut / scrubMax) * 100}%` }} />
        ))}
      </div>
    </div>
  );

  return (
    <div className={styles.well} data-export-preview data-state={mode}>
      <div
        className={styles.picture}
        ref={picture}
        style={{ aspectRatio: `${rw} / ${rh}` }}
        data-picker={mode === "picker"}
      >
        <div
          className={styles.sourceFrame}
          style={{ display: inResult ? "none" : undefined }}
        >
          <div
            className={styles.videoLayer}
            data-layer-id="video"
            style={{
              zIndex: layerZ(scene, "video"),
              ...videoMotion,
              background: clip?.url
                ? "#000"
                : clip
                  ? `linear-gradient(160deg, ${clip.color}, #15151c)`
                  : "#000",
            }}
          >
            <video
              ref={sourceVideo}
              playsInline
              preload="metadata"
              muted={muted || !!clip?.audioDetached}
              className={styles.sourceVideo}
              style={{
                visibility: clip?.url ? "visible" : "hidden",
                objectFit: clip?.fit ?? "contain",
                transform: `scale(${clip?.mirror ? -(clip.zoom ?? 1) : (clip?.zoom ?? 1)}, ${clip?.zoom ?? 1})`,
              }}
              onTimeUpdate={(event) => sourcePosition(event.currentTarget)}
              onEnded={sourceEnded}
            />
          </div>
          {!inResult && textLayers}
          {!inResult && componentLayers}
        </div>
        {resultSource && (
          <video
            ref={resultVideo}
            className={styles.resultVideo}
            src={resultSource}
            data-visible={inResult}
            playsInline
            muted={muted}
            preload="auto"
            style={
              interactiveResult
                ? {
                    zIndex: layerZ(scene, "video"),
                    background: "#000",
                    ...videoMotion,
                  }
                : undefined
            }
            onLoadedData={resultLoaded}
            onTimeUpdate={(event) => resultPosition(event.currentTarget)}
            onEnded={stop}
          />
        )}
        {interactiveResult && textLayers}
        {interactiveResult && componentLayers}
        <span
          className={`${styles.label} ${mode === "picker" ? styles.coverLabel : ""}`}
        >
          {mode === "picker"
            ? `COVER · ${exportClock(pickerTime)}`
            : inResult
              ? "✓ EXPORTED FILE"
              : "PREVIEW"}
        </span>
        {mode !== "picker" && (
          <button
            type="button"
            className={styles.mobileMute}
            aria-label={muted ? "Unmute preview" : "Mute preview"}
            onClick={toggleMuted}
          >
            {muted ? "×" : "◖"}
          </button>
        )}
      </div>
      <div className={styles.transport} data-picker={mode === "picker"}>
        {mode !== "picker" && (
          <button
            type="button"
            className={styles.play}
            onClick={togglePlay}
            aria-label={
              playing ? "Pause export preview" : "Play export preview"
            }
          >
            {playing ? "Ⅱ" : "▶"}
          </button>
        )}
        <span className={styles.time}>
          {exportClock(shownTime)} <small>/ {exportClock(duration)}</small>
        </span>
        {slider}
        {mode !== "picker" && (
          <button
            type="button"
            className={styles.desktopMute}
            onClick={toggleMuted}
            aria-label={muted ? "Unmute preview" : "Mute preview"}
          >
            {muted ? "MUTED" : "◖"}
          </button>
        )}
        {mode === "picker" && (
          <span className={styles.pickerEnd}>
            {exportClock(duration, false)}
          </span>
        )}
      </div>
      <p className={styles.previewNote}>
        {mode === "picker"
          ? "Scrub to the frame you want for the cover."
          : mode === "exporting"
            ? "Preview only — the finished file plays here when ready."
            : mode === "gate"
              ? "Keep watching while you sign in — nothing is lost."
              : inResult
                ? "Playing the exported file — what viewers will get."
                : "Project preview at the export aspect ratio."}
      </p>
    </div>
  );
}
