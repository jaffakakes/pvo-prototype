import { evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import { useAudioPlayback } from "../sound/useAudioPlayback";
import { useMusicPlayback } from "../sound/useMusicPlayback";
import { total } from "../../domain/clips/timing";
import { sceneDuration } from "../../domain/scenes/duration";
import { componentEnd } from "../../domain/components/timing";
import { useLayoutEffect, useRef, useState } from "react";
import { dur,locate } from "../../domain/clips/timing";
import { layerOrder, layerZ } from "../../domain/layers/order";
import { projectRatio } from "../../domain/project/ratio";
import { useCapture } from "../../state/captureStore";
import { useAssistant } from "../../state/assistant/assistantStore";
import { setCodePreviewFocus, useComponentAuthoring } from "../../state/components/componentAuthoringStore";
import { useEditorPreferences } from "../../state/preferences/editorPreferences";
import { cx } from "../../styles";
import { TextLayer } from "../text/TextLayer";
import { ComponentOverlay,componentVisible } from "./ComponentOverlay";
import { fitPreviewSize } from "./geometry";
import styles from "./Preview.module.css";
import { runComponentResponse } from "./tryMode";
import { usePlayback } from "./usePlayback";
import { useOverlayGestures } from "./useOverlayGestures";
import { usePreviewAreaSize } from "./usePreviewAreaSize";
import { Icon } from "../../ui/Icon";
import { StageMotionPath } from "../animation/stage/StageMotionPath";

type Props = { desktop?: boolean; onAddMedia?(): void };

export function Preview({ desktop = false, onAddMedia }: Props = {}) {
  const s = useCapture();
  const assistantActive = useAssistant(state => state.phase !== "idle");
  const authoring = useComponentAuthoring();
  const advanced = useEditorPreferences(state => state.advancedEditingEnabled);
  const { areaRef, area } = usePreviewAreaSize();
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const gestures = useOverlayGestures(boxRef, desktop);
  const located = s.trim ? { c: s.clips[s.trim.i], i: s.trim.i } : locate(s.t, s.clips);
  const duration = sceneDuration(s);
  const sourceTime = s.trim?.lt ?? locate(s.t, s.clips)?.lt ?? 0;
  const sceneTail = s.t >= total(s.clips) && duration > total(s.clips);
  const clip = sceneTail ? undefined : located?.c;
  const motion = evaluateAnimation(clip?.animation, sourceTime);
  usePlayback(videoRef);
  useAudioPlayback();
  useMusicPlayback();
  const { width: bw, height: bh } = fitPreviewSize(area.width, area.height, projectRatio(s.ratio));
  const compact = bw < 180;
  const selectedAuthoring = !s.tryMode && !s.playheadPick && !s.playing;
  const endpointAuthoring = selectedAuthoring && (desktop || s.sheet === "animation");
  const visibleComponents = s.components.filter(component => componentVisible(component, s.clips, s.t, s.tryMode?.holdingId ?? null)
    || (selectedAuthoring && s.selComp === component.id && (desktop || s.sheet === "component" || assistantActive
      || (s.sheet === "animation" && Math.abs(s.t - componentEnd(component, s.clips)) < 1e-6))));
  const codeEditing = advanced && authoring.codePreviewFocus && authoring.tab === "advanced"
    && authoring.componentId === s.selComp && s.sheet !== "animation"
    && (desktop || s.sheet === "component");
  const focusCandidate = codeEditing && selectedAuthoring && !assistantActive
    ? visibleComponents.find(component => component.id === s.selComp) : undefined;
  const [focusAnchor, setFocusAnchor] = useState<{ id: string; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    // Freeze the rendered entrance point while this source editing session stays focused.
    setFocusAnchor(previous => {
      if (!focusCandidate) return null;
      if (previous?.id === focusCandidate.id) return previous;
      const motion = evaluateAnimation(focusCandidate.animation, s.t - focusCandidate.at);
      return { id: focusCandidate.id, x: focusCandidate.x + motion.x, y: focusCandidate.y + motion.y };
    });
  }, [focusCandidate, s.t]);
  const focused = focusCandidate?.id === focusAnchor?.id ? focusAnchor : null;
  const dimmerZ = layerOrder(s).length + 1;

  return <div ref={areaRef} className={`${cx("previewArea")} ${styles.area}`} data-desktop={desktop}>
    <div ref={boxRef} className={`${cx("pvBox")} ${styles.canvas}`} data-trying={!!s.tryMode}
      data-compact={compact} data-desktop={desktop} style={{ width: bw, height: bh }} {...gestures}
      onPointerDownCapture={event => {
        if (focused) {
          const focusedTarget = (event.target as Element).closest<HTMLElement>('[data-component-focused="true"]');
          setCodePreviewFocus(false);
          if (focusedTarget) {
            // The lift is presentation only. Return to the authored position before a placement gesture.
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }
        gestures.onPointerDownCapture(event);
        if (desktop && !event.defaultPrevented && !s.tryMode && !s.playheadPick && clip
          && !(event.target as Element).closest("button")) {
          s.patch({ sel: located?.i ?? -1, selComp: null, selText: null, sheet: null });
        }
      }}>
    <div className={cx("videoLayer")} data-layer-id="video" data-animation-selected={!s.tryMode && s.sel >= 0 && s.clips[s.sel]?.id === clip?.id}
      style={{ zIndex: layerZ(s, "video"), opacity: motion.opacity,
      transform: `translate(${motion.x}%, ${motion.y}%) rotate(${motion.rotation}deg) scale(${motion.scaleX}, ${motion.scaleY})` }}>
      {clip?.url ? <video ref={videoRef} className={cx("pvVideo")} playsInline style={{ objectFit: clip.fit, transform: `scale(${clip.mirror ? -clip.zoom : clip.zoom},${clip.zoom})` }} /> :
        <div className={cx("pvFallback")} style={{ background: sceneTail ? "#000" : `linear-gradient(160deg,${clip?.color ?? "#000"},#15151C)` }}>{!sceneTail && <img src="restyle-mark.png" alt="" />}</div>}
    </div>
    {s.texts.filter(text => (s.t >= text.start && s.t < text.end)
      || (endpointAuthoring && s.selText === text.id && Math.abs(s.t - text.end) < 1e-6))
      .map(text => <TextLayer key={text.id} overlay={text} width={bw} height={bh}
        zIndex={layerZ(s, `text:${text.id}`)} selected={s.selText === text.id}
        trying={!!s.tryMode} time={Math.min(s.t, text.end)} />)}
    {focused && <div className={styles.componentDimmer} data-component-focus-dimmer
      aria-hidden="true" style={{ zIndex: dimmerZ }} />}
    {visibleComponents.map(component => <ComponentOverlay key={component.id} component={component}
        width={bw} zIndex={layerZ(s, `component:${component.id}`)} selected={s.selComp === component.id}
        focus={focused?.id === component.id ? {
          x: (50 - focused.x) / 100 * bw,
          y: (50 - focused.y) / 100 * bh,
          zIndex: dimmerZ + 1,
        } : null}
        trying={!!s.tryMode} time={s.t} onResponse={runComponentResponse} />)}
    {!focused && <StageMotionPath width={bw} height={bh} />}
    {!compact && !s.tryMode && clip && <span className={cx("tag pvTag")}><i /><span>Clip {(located?.i ?? 0) + 1} · {dur(clip).toFixed(1)}s</span></span>}
    {desktop && s.tryMode && <span className={styles.tryBadge}><i />Trying</span>}
    {desktop && duration <= 0 && <div className={styles.empty}>
      <span><Icon name="edit" size={24} /></span>
      <strong>Nothing here yet</strong>
      <button type="button" onClick={onAddMedia}>Add clips from Media</button>
    </div>}
  </div></div>;
}
