import { cx } from "../styles";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../lib/icons";
import { clamp, fmt, round2 } from "../lib/format";
import { dur, LEAD, locate, MID, PPS, stripLeft, total } from "../lib/timeline";
import { FX, RATIOS, TEXT_COLORS, useCapture, uid } from "../store";
import type { Clip, TextOverlay } from "../store";

function clipCount(count: number, seconds: number) { return `${count} clip${count === 1 ? "" : "s"} · ${fmt(seconds)}`; }

function usePlayback(videoRef: React.RefObject<HTMLVideoElement>) {
  const raf = useRef(0);
  const last = useRef(0);
  const { clips, t, playing, muted, trim, patch } = useCapture();
  const current = trim ? { c: clips[trim.i], lt: trim.lt } : locate(t, clips);
  useEffect(() => {
    const video = videoRef.current;
    const clip = current?.c;
    if (!video || !clip?.url) { video?.pause(); return; }
    if (video.getAttribute("data-url") !== clip.url) {
      video.setAttribute("data-url", clip.url);
      video.src = clip.url;
      video.load();
    }
    const sync = () => {
      if (video.readyState < 1) return;
      video.muted = muted;
      video.playbackRate = clamp(clip.speed, .25, 4);
      const localTime = current?.lt ?? clip.in;
      if (Math.abs(video.currentTime - localTime) > (playing ? .3 : .04)) video.currentTime = localTime;
      if (playing && video.paused) video.play().catch(() => {});
      if (!playing && !video.paused) video.pause();
    };
    video.addEventListener("loadedmetadata", sync);
    sync();
    return () => video.removeEventListener("loadedmetadata", sync);
  }, [videoRef, current?.c?.id, current?.lt, current?.c?.url, playing, muted]);
  useEffect(() => {
    if (!playing) { cancelAnimationFrame(raf.current); last.current = 0; return; }
    const tick = (time: number) => {
      const dt = last.current ? Math.min(.1, (time - last.current) / 1000) : 0;
      last.current = time;
      const s = useCapture.getState();
      const next = s.t + dt;
      if (next >= total(s.clips)) { s.patch({ t: total(s.clips), playing: false }); return; }
      s.patch({ t: next });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf.current); last.current = 0; };
  }, [playing, patch]);
}

function Preview() {
  const s = useCapture();
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [area, setArea] = useState({ width: 370, height: 440 });
  const totalTime = total(s.clips);
  const located = s.trim ? { c: s.clips[s.trim.i], i: s.trim.i } : locate(s.t, s.clips);
  const clip = located?.c;
  usePlayback(videoRef);
  useEffect(() => {
    const host = boxRef.current?.parentElement;
    if (!host) return;
    const ro = new ResizeObserver(() => setArea({ width: Math.min(370, host.clientWidth - 60), height: Math.min(440, host.clientHeight - 16) }));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  const [rw, rh] = RATIOS[s.ratio];
  let bw = Math.max(100, area.width), bh = Math.max(100, area.height);
  if (bw / bh > rw / rh) bw = Math.round(bh * rw / rh);
  else bh = Math.round(bw * rh / rw);
  const fs = bw * .073;

  const textDown = (event: ReactPointerEvent, overlay: TextOverlay) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: overlay.id, x: event.clientX, y: event.clientY, ox: overlay.x, oy: overlay.y, moved: false };
  };
  const textMove = (event: ReactPointerEvent) => {
    const d = drag.current;
    const box = boxRef.current;
    if (!d || !box) return;
    const dx = event.clientX - d.x, dy = event.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 3) { useCapture.getState().edit({}); d.moved = true; }
    if (d.moved) useCapture.getState().patch({ texts: useCapture.getState().texts.map(item => item.id === d.id ? { ...item, x: clamp(d.ox + dx / box.clientWidth * 100, 8, 92), y: clamp(d.oy + dy / box.clientHeight * 100, 6, 94) } : item) });
  };
  const textUp = () => { const d = drag.current; drag.current = null; if (d && !d.moved) s.patch({ sheet: "text" }); };

  return <div className={cx("previewArea")}><div ref={boxRef} className={cx("pvBox")} style={{ width: bw, height: bh }}>
    {clip?.url ? <video ref={videoRef} className={cx("pvVideo")} playsInline style={{ filter: FX[clip.fx].css, transform: `scale(${clip.mirror ? -clip.zoom : clip.zoom},${clip.zoom})` }} /> :
      <div className={cx("pvFallback")} style={{ background: `linear-gradient(160deg,${clip?.color ?? "#15151C"},#15151C)`, filter: FX[clip?.fx ?? 0].css }}><img src="restyle-mark.png" alt="" /></div>}
    {s.texts.filter(x => s.t >= x.start && s.t <= x.end).map(x => <button key={x.id} className={cx("textOverlay")} onPointerDown={e => textDown(e, x)} onPointerMove={textMove} onPointerUp={textUp} style={{ left: `${x.x}%`, top: `${x.y}%`, background: TEXT_COLORS[x.color].bg, color: TEXT_COLORS[x.color].fg, fontSize: fs, padding: `${fs * .2}px ${fs * .65}px` }}>{x.text}</button>)}
    <span className={cx("tag pvTag")}><i />Clip {(located?.i ?? 0) + 1} · {clip ? dur(clip).toFixed(1) : "0.0"}s</span>
  </div></div>;
}

function Transport() {
  const s = useCapture();
  return <div className={cx("transport")}><div className={cx("transportTime")}>{fmt(s.t)} <span>/ {fmt(total(s.clips))}</span></div>
    <button className={cx("playBtn press")} onClick={() => s.patch({ playing: !s.playing, t: s.t >= total(s.clips) ? 0 : s.t })} aria-label={s.playing ? "Pause" : "Play"}><Icon name={s.playing ? "pause" : "play"} size={s.playing ? 18 : 20} /></button>
    <div className={cx("transportRight")}><button onClick={s.undo} disabled={!s.past.length} aria-label="Undo"><Icon name="undo" size={14} /></button><button onClick={s.redo} disabled={!s.future.length} aria-label="Redo"><Icon name="redo" size={14} /></button><button onClick={() => document.querySelector<HTMLElement>(".pvBox")?.requestFullscreen?.()} aria-label="Full screen"><Icon name="fullscreen" size={14} /></button></div>
  </div>;
}

function Timeline() {
  const s = useCapture();
  const timelineRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; start: number; dragged: boolean; clipIndex: number } | null>(null);
  const ignoreClick = useRef(false);
  const trimRef = useRef<{ x: number; clip: Clip; side: "l" | "r"; index: number; moved: boolean } | null>(null);
  const length = total(s.clips);
  const trimShift = s.trim?.shift ?? 0;
  const ticks = Array.from({ length: Math.ceil(length) + 5 }, (_, i) => i);

  const scrubDown = (event: ReactPointerEvent) => {
    if ((event.target as HTMLElement).closest(".mute,.addClip,.textBar,.textAdd,.handle")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = (event.target as HTMLElement).closest<HTMLElement>(".tlClip")?.dataset.index;
    pointer.current = { x: event.clientX, start: s.t, dragged: false, clipIndex: index == null ? -1 : Number(index) };
  };
  const scrubMove = (event: ReactPointerEvent) => {
    const d = pointer.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    if (!d.dragged && Math.abs(dx) < 5) return;
    d.dragged = true;
    useCapture.getState().patch({ playing: false, t: clamp(d.start - dx / PPS, 0, total(useCapture.getState().clips)) });
  };
  const scrubUp = (event: ReactPointerEvent) => {
    const d = pointer.current;
    pointer.current = null;
    if (d?.dragged) { ignoreClick.current = true; window.setTimeout(() => { ignoreClick.current = false; }, 0); }
    if (d && !d.dragged) s.patch({ sel: d.clipIndex, orb: false });
  };

  const trimDown = (event: ReactPointerEvent, index: number, side: "l" | "r") => {
    event.stopPropagation();
    if (event.button > 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const clip = s.clips[index];
    trimRef.current = { x: event.clientX, clip, side, index, moved: false };
    s.patch({ playing: false, trim: { i: index, side, shift: 0, lt: side === "l" ? clip.in : clip.out - .04 } });
  };
  const trimMove = (event: ReactPointerEvent) => {
    const d = trimRef.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 2) return;
    if (!d.moved) { s.edit({}); d.moved = true; }
    const delta = dx / PPS * d.clip.speed;
    const minLength = .3 * d.clip.speed;
    const clip = { ...d.clip };
    if (d.side === "l") clip.in = clamp(d.clip.in + delta, 0, d.clip.out - minLength);
    else clip.out = clamp(d.clip.out + delta, d.clip.in + minLength, d.clip.srcDur);
    const clips = useCapture.getState().clips.map((c, i) => i === d.index ? clip : c);
    useCapture.getState().patch({ clips, trim: { i: d.index, side: d.side, shift: d.side === "l" ? (dur(d.clip) - dur(clip)) * PPS : 0, lt: d.side === "l" ? clip.in : Math.max(clip.in, clip.out - .04) } });
  };
  const trimUp = () => {
    if (!trimRef.current) return;
    const shift = useCapture.getState().trim?.shift ?? 0;
    trimRef.current = null;
    const state = useCapture.getState();
    state.patch({ trim: null, t: clamp(state.t - shift / PPS, 0, total(state.clips)) });
  };

  return <div ref={timelineRef} className={cx("tl")} onPointerDown={scrubDown} onPointerMove={scrubMove} onPointerUp={scrubUp}>
    <div className={cx("strip")} style={{ left: stripLeft(s.t, trimShift), width: LEAD + length * PPS + 240 }}>
      {ticks.map(k => <span key={k} className={cx("tick")} style={{ left: LEAD + k * PPS }}>{k % 2 ? "·" : fmt(k)}</span>)}
      <button className={cx("mute")} style={{ left: 8 }} onPointerDown={e => e.stopPropagation()} onClick={() => { s.edit({ muted: !s.muted }); s.notify(s.muted ? "Clip audio on" : "Clip audio off"); }} aria-label="Clip audio"><Icon name={s.muted ? "muted" : "speaker"} size={18} /></button>
      <div className={cx("tlClips")} style={{ left: LEAD }}>{s.clips.map((clip, i) => <button key={clip.id} className={cx("tlClip")} data-index={i} data-sel={s.sel === i} style={{ width: dur(clip) * PPS, background: `linear-gradient(160deg,${clip.color},#15151C)` }} onClick={() => { if (!ignoreClick.current) s.patch({ sel: i, orb: false }); }}>
        {clip.url && <video src={`${clip.url}#t=${(Math.round(clip.in * 2) / 2).toFixed(1)}`} muted playsInline style={{ filter: FX[clip.fx].css, transform: clip.mirror ? "scaleX(-1)" : undefined }} />}
        {dur(clip) * PPS > 46 && <span className={cx("clipLen")} style={{ left: s.sel === i ? 18 : 6 }}>{dur(clip).toFixed(1)}s</span>}
        {s.sel === i && <><span className={cx("handle handleL")} onPointerDown={e => trimDown(e, i, "l")} onPointerMove={trimMove} onPointerUp={trimUp} /><span className={cx("handle handleR")} onPointerDown={e => trimDown(e, i, "r")} onPointerMove={trimMove} onPointerUp={trimUp} /></>}
      </button>)}<button className={cx("addClip")} onPointerDown={e => e.stopPropagation()} onClick={() => s.patch({ screen: "camera", sel: -1, playing: false })} aria-label="Add clip"><Icon name="plus" size={16} /></button></div>
      <div className={cx("audioTrack")} style={{ left: LEAD, width: Math.max(40, length * PPS), opacity: s.muted && !s.sound ? .4 : 1 }}><span>♪ {s.sound ? ["", "Summer Groove", "Night Drive", "Hype Mode", "Soft Focus"][s.sound] : "original sound"}{s.muted && !s.sound ? " · muted" : ""}</span></div>
      {s.texts.length ? s.texts.map(x => <button key={x.id} className={cx("textBar")} style={{ left: LEAD + x.start * PPS, width: Math.max(24, (x.end - x.start) * PPS), background: TEXT_COLORS[x.color].bg, color: TEXT_COLORS[x.color].fg }} onPointerDown={e => e.stopPropagation()} onClick={() => s.patch({ sheet: "text" })}>{x.text}</button>) : <button className={cx("textAdd")} style={{ left: LEAD, width: Math.max(140, length * PPS) }} onPointerDown={e => e.stopPropagation()} onClick={() => s.patch({ sheet: "text" })}>＋ Add text</button>}
    </div><div className={cx("playhead")} />
  </div>;
}

function ToolRow() {
  const s = useCapture();
  const selected = s.sel >= 0 ? s.clips[s.sel] : null;
  const length = total(s.clips);
  const split = () => {
    const located = locate(s.t, s.clips);
    if (!located || located.lt - located.c.in < .15 * located.c.speed || located.c.out - located.lt < .15 * located.c.speed) { s.notify("Move the playhead inside a clip"); return; }
    const left = { ...located.c, out: located.lt };
    const right = { ...located.c, id: uid(), in: located.lt };
    const clips = [...s.clips]; clips.splice(located.i, 1, left, right);
    s.edit({ clips, sel: located.i + 1, playing: false }); s.notify("Split");
  };
  const deleteClip = () => {
    if (s.sel < 0) return;
    const clips = s.clips.filter((_, i) => i !== s.sel);
    s.edit({ clips, sel: -1, t: clamp(s.t, 0, total(clips)), playing: false, screen: clips.length ? "editor" : "camera" }); s.notify("Clip deleted");
  };
  const action = (name: string) => {
    if (name === "edit") { const loc = locate(s.t, s.clips); if (loc) s.patch({ sel: loc.i, orb: false }); }
    else if (name === "split") split();
    else if (name === "replace" && selected) s.patch({ replacing: selected.id, screen: "camera", sel: -1, playing: false });
    else if (name === "delete") deleteClip();
    else if (name === "collapse") s.patch({ sel: -1 });
    else if (name === "filters") s.patch({ sheet: "fx", fxScope: "all", playing: false, orb: false });
    else if (name === "filter") s.patch({ sheet: "fx", fxScope: "clip", playing: false, orb: false });
    else s.patch({ sheet: name as CaptureStateSheet, playing: false, orb: false });
  };
  type CaptureStateSheet = "text" | "sound" | "ratio" | "speed" | "crop";
  const tools = selected ? [["down", "", "collapse"], ["split", "Split", "split"], ["replace", "Replace", "replace"], ["delete", "Delete", "delete"], ["speed", "Speed", "speed"], ["crop", "Crop", "crop"], ["filters", "Filter", "filter"]] : [["edit", "Edit clip", "edit"], ["text", "Text", "text"], ["filters", "Filters", "filters"], ["music", "Sound", "sound"], ["ratio", "Ratio", "ratio"]];
  const orbAction = (kind: string) => {
    if (kind === "pace") { s.edit({ clips: s.clips.map(c => ({ ...c, speed: Math.min(3, round2(c.speed * 1.25)) })), orb: false }); s.notify("✦ Paced up"); }
    if (kind === "title") { s.edit({ texts: [...s.texts, { id: uid(), text: "Day in the life", color: 2, start: 0, end: length, x: 50, y: 16 }], orb: false }); s.notify("✦ Title added"); }
    if (kind === "warm") { s.edit({ clips: s.clips.map(c => ({ ...c, fx: 1 })), orb: false }); s.notify("✦ Warm look applied"); }
  };
  return <div className={cx("toolBar")}><div className={cx("tools")}>{tools.map(([icon, label, name]) => <button key={name} className={cx(`tool tool-${name}`)} onClick={() => action(name)} aria-label={label || "Collapse clip tools"}><Icon name={icon} size={20} />{label && <span>{label}</span>}</button>)}</div>
    <button className={cx("orb")} data-awake={s.orb} onClick={() => s.patch({ orb: !s.orb, playing: false })} aria-label="Restyle AI"><img src="restyle-mark.png" alt="" /></button>
    {s.orb && !s.sheet && <div className={cx("orbActs")}>{[["pace", "Tighten pace 1.25×", "#FF6FA6"], ["title", "Add a title", "#FFD23E"], ["warm", "Warm every clip", "#FF9F6E"]].map(([kind, label, color]) => <button key={kind} className={cx("orbAct")} onClick={() => orbAction(kind)}><i style={{ background: color, boxShadow: `0 0 8px ${color}` }} />✦ {label}</button>)}</div>}
  </div>;
}

export function Editor() {
  const s = useCapture();
  const length = total(s.clips);
  useEffect(() => { if (!s.clips.length) s.patch({ screen: "camera" }); }, [s.clips.length]);
  if (!s.clips.length) return null;
  return <><header className={cx("editorHead")}><button className={cx("backBtn")} onClick={() => s.patch({ screen: "camera", sel: -1, orb: false, playing: false })} aria-label="Back to camera"><Icon name="back" size={19} /></button><div className={cx("editorTitle")}><h1>Edit</h1><p>{clipCount(s.clips.length, length)}</p></div><button className={cx("nextBtn press")} onClick={() => s.patch({ sheet: "export", playing: false, orb: false })}>Next <Icon name="arrow" size={16} /></button></header>
    <Preview /><Transport /><Timeline /><ToolRow />
  </>;
}
