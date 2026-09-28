import { useAudioPlayback } from "../sound/useAudioPlayback";
import { total } from "../../domain/clips/timing";
import { sceneDuration } from "../../domain/audio/editing";
import { useLayoutEffect,useRef,useState } from "react";
import { dur,locate } from "../../domain/clips/timing";
import { layerZ } from "../../domain/layers/order";
import { projectRatio } from "../../domain/project/ratio";
import { useCapture } from "../../state/captureStore";
import { useAssistant } from "../../state/assistant/assistantStore";
import { cx } from "../../styles";
import { TextLayer } from "../text/TextLayer";
import { ComponentOverlay,componentVisible } from "./ComponentOverlay";
import { fitPreviewSize } from "./geometry";
import styles from "./Preview.module.css";
import { runOutcome } from "./tryMode";
import { usePlayback } from "./usePlayback";
import { useOverlayGestures } from "./useOverlayGestures";
import { Icon } from "../../ui/Icon";

type Props = { desktop?: boolean; safeZone?: boolean; onAddMedia?(): void };

export function Preview({ desktop = false, safeZone = false, onAddMedia }: Props = {}) {
  const s = useCapture();
  const assistant = useAssistant();
  const areaRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const gestures = useOverlayGestures(boxRef, desktop);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const located = s.trim ? { c: s.clips[s.trim.i], i: s.trim.i } : locate(s.t, s.clips);
  const audioTail = s.t >= total(s.clips) && sceneDuration(s) > total(s.clips);
  const clip = audioTail ? undefined : located?.c;
  usePlayback(videoRef);
  useAudioPlayback();
  useLayoutEffect(() => {
    const host = areaRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setArea(previous => previous.width === width && previous.height === height
        ? previous : { width, height });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const { width: bw, height: bh } = fitPreviewSize(area.width, area.height, projectRatio(s.ratio));
  const compact = bw < 180;

  return <div ref={areaRef} className={`${cx("previewArea")} ${styles.area}`} data-desktop={desktop}>
    <div ref={boxRef} className={`${cx("pvBox")} ${styles.canvas}`} data-trying={!!s.tryMode}
      data-compact={compact} data-desktop={desktop} style={{ width: bw, height: bh }} {...gestures}
      onPointerDownCapture={event => {
        gestures.onPointerDownCapture(event);
        if (desktop && !event.defaultPrevented && !s.tryMode && !s.playheadPick && clip
          && !(event.target as Element).closest("button")) {
          s.patch({ sel: located?.i ?? -1, selComp: null, selText: null, sheet: null });
        }
      }}>
    <div className={cx("videoLayer")} data-layer-id="video" style={{ zIndex: layerZ(s, "video") }}>
      {clip?.url ? <video ref={videoRef} className={cx("pvVideo")} playsInline style={{ objectFit: clip.fit, transform: `scale(${clip.mirror ? -clip.zoom : clip.zoom},${clip.zoom})` }} /> :
        <div className={cx("pvFallback")} style={{ background: audioTail ? "#000" : `linear-gradient(160deg,${clip?.color ?? "#000"},#15151C)` }}>{!audioTail && <img src="restyle-mark.png" alt="" />}</div>}
    </div>
    {s.texts.filter(x => s.t >= x.start && s.t < x.end).map(x => <TextLayer key={x.id} overlay={x} width={bw} height={bh} zIndex={layerZ(s, `text:${x.id}`)} selected={s.selText === x.id} trying={!!s.tryMode} />)}
    {s.components.filter(component => componentVisible(component, s.clips, s.t, s.tryMode?.holdingId ?? null)
      || (!s.tryMode && !s.playheadPick && (desktop || s.sheet === "component" || assistant.phase !== "idle") && s.selComp === component.id))
      .map(component => {
        const reviewing = assistant.review?.original.id === component.id && !s.tryMode;
        const proposed = reviewing && !assistant.before;
        return <ComponentOverlay key={component.id}
          component={proposed ? assistant.review!.proposed : component} proposed={proposed} before={reviewing && assistant.before}
          width={bw} zIndex={layerZ(s, `component:${component.id}`)} selected={s.selComp === component.id}
          trying={!!s.tryMode} onOutcome={runOutcome} />;
      })}
    {!compact && !s.tryMode && clip && <span className={cx("tag pvTag")}><i /><span>Clip {(located?.i ?? 0) + 1} · {dur(clip).toFixed(1)}s</span></span>}
    {desktop && safeZone && clip && <div className={styles.guides} data-portrait={s.ratio === "9:16"} aria-hidden="true">
      <div className={styles.safeBorder} />
      {s.ratio === "9:16" && <div className={styles.socialGuides}><i /><i /><i /></div>}
    </div>}
    {desktop && s.tryMode && <span className={styles.tryBadge}><i />Trying</span>}
    {desktop && !clip && !s.audioClips.length && <div className={styles.empty}>
      <span><Icon name="edit" size={24} /></span>
      <strong>Nothing here yet</strong>
      <button type="button" onClick={onAddMedia}>Add clips from Media</button>
    </div>}
  </div></div>;
}
