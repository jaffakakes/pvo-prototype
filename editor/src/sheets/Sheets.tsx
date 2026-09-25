import { cx } from "../styles";
import { useEffect, useRef } from "react";
import { Icon } from "../lib/icons";
import { fmt } from "../lib/format";
import { dur, total } from "../lib/timeline";
import { exportVideo } from "../lib/export";
import { previewSound } from "../lib/sound";
import { FX, RATIOS, SOUNDS, TEXT_COLORS, uid, useCapture } from "../store";
import type { Ratio } from "../store";

function Shell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  const close = () => useCapture.getState().patch({ sheet: null });
  return <><div className={cx("sheetScrim")} onClick={close} /><section className={cx("sheet")} role="dialog" aria-modal="true" aria-label={title}>
    <div className={cx("grabber")} /><header className={cx("sheetHead")}><div><h2>{title}</h2><p>{sub}</p></div><button className={cx("sheetClose")} onClick={close} aria-label="Close"><Icon name="close" size={17} /></button></header>
    {children}
  </section></>;
}

function TextSheet() {
  const s = useCapture();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const length = total(s.clips);
  const start = Math.max(0, Math.min(s.t, length - 1));
  const add = () => {
    const value = s.draft.trim();
    if (!value || !s.clips.length) return;
    s.edit({ texts: [...s.texts, { id: uid(), text: value, color: s.tColor, start, end: Math.min(length, start + 3), x: 50, y: 45 }], draft: "", sheet: null });
    s.notify("Text added — drag to move");
  };
  return <Shell title="Text" sub="Shows for 3s from the playhead · drag it on the preview">
    <div className={cx("textEntry")}><input ref={input} value={s.draft} maxLength={40} placeholder="Type something…" onChange={event => s.patch({ draft: event.target.value })} onKeyDown={event => { if (event.key === "Enter") add(); }} /><button className={cx("press")} disabled={!s.draft.trim()} onClick={add}>Add</button></div>
    <div className={cx("colorRow")}>{TEXT_COLORS.map((color, index) => <button key={index} className={cx("colorSwatch")} data-on={s.tColor === index} style={{ background: color.bg, borderColor: index === 4 ? "rgba(242,240,233,.35)" : "#000" }} onClick={() => s.patch({ tColor: index })} aria-label={`Text color ${index + 1}`} />)}</div>
    {s.texts.length > 0 && <div className={cx("textList")}>{s.texts.map(text => <div className={cx("textItem")} key={text.id}><i style={{ background: TEXT_COLORS[text.color].bg }} /><span>{text.text}</span><small>{fmt(text.start)}–{fmt(text.end)}</small><button onClick={() => s.edit({ texts: s.texts.filter(item => item.id !== text.id) })} aria-label="Remove"><Icon name="delete" size={13} /></button></div>)}</div>}
  </Shell>;
}

function ExportSheet() {
  const s = useCapture();
  const length = total(s.clips);
  const start = async () => {
    if (s.ex === "running") return;
    s.patch({ ex: "running", exPct: 0 });
    try {
      const result = await exportVideo(useCapture.getState(), progress => useCapture.getState().patch({ exPct: Math.round(progress * 100) }));
      const state = useCapture.getState();
      if (state.exUrl) URL.revokeObjectURL(state.exUrl);
      state.patch({ ex: "done", exPct: 100, exUrl: result.url, exName: result.name });
      const link = document.createElement("a"); link.href = result.url; link.download = result.name; link.click();
    } catch (error) {
      useCapture.getState().patch({ ex: "idle" });
      useCapture.getState().notify(error instanceof Error ? error.message : "Export failed");
    }
  };
  return <Shell title="Export" sub={`${s.clips.length} clip${s.clips.length === 1 ? "" : "s"} · ${fmt(length)} · ${s.ratio}`}>
    <div className={cx("qualityGrid")}>{(["720p", "1080p"] as const).map(quality => <button key={quality} data-on={s.quality === quality} onClick={() => s.patch({ quality })} disabled={s.ex === "running"}><strong>{quality}</strong><span>{quality === "720p" ? "Faster · smaller file" : "Sharper · bigger file"}</span></button>)}</div>
    {s.ex === "idle" && <button className={cx("exportBtn press")} onClick={start}><Icon name="export" size={18} /> Export video</button>}
    {s.ex === "running" && <div className={cx("exportProgress")}><div><strong>Rendering…</strong><strong>{s.exPct}%</strong></div><span><i style={{ width: `${s.exPct}%` }} /></span><p>Plays through once in real time — keep this tab open.</p></div>}
    {s.ex === "done" && <><div className={cx("exportSuccess")}><Icon name="check" size={18} />Saved {s.exName}</div><div className={cx("exportDone")}><a href={s.exUrl ?? undefined} download={s.exName}>Download</a><button onClick={() => s.reset()}>New video</button></div></>}
  </Shell>;
}

export function Sheets() {
  const s = useCapture();
  const cropSnapshot = useRef(false);
  useEffect(() => { cropSnapshot.current = false; }, [s.sheet]);
  if (!s.sheet) return null;
  const selected = s.sel >= 0 ? s.clips[s.sel] : null;
  const selectedSub = selected ? `Clip ${s.sel + 1} · ${dur(selected).toFixed(1)}s` : "";
  const updateClip = (values: Partial<NonNullable<typeof selected>>, continuous = false) => {
    if (!selected) return;
    const clips = s.clips.map((clip, index) => index === s.sel ? { ...clip, ...values } : clip);
    if (continuous && cropSnapshot.current) s.patch({ clips });
    else { s.edit({ clips }); if (continuous) cropSnapshot.current = true; }
  };
  if (s.sheet === "text") return <TextSheet />;
  if (s.sheet === "export") return <ExportSheet />;
  if (s.sheet === "speed") return <Shell title="Speed" sub={selectedSub}><div className={cx("speedGrid")}>{[.5, 1, 1.5, 2, 3].map(speed => <button key={speed} className={cx("sheetPill")} data-on={selected?.speed === speed} onClick={() => { updateClip({ speed }); s.patch({ t: Math.min(s.t, total(useCapture.getState().clips)) }); }}>{speed}x</button>)}</div></Shell>;
  if (s.sheet === "crop") return <Shell title="Crop" sub={`Clip ${s.sel + 1} · zoom and mirror`}><div className={cx("zoomLabel")}><span>Zoom</span><strong>{Math.round((selected?.zoom ?? 1) * 100)}%</strong></div><input className={cx("zoomRange")} type="range" min="100" max="200" step="1" value={Math.round((selected?.zoom ?? 1) * 100)} onChange={event => updateClip({ zoom: Number(event.target.value) / 100 }, true)} /><div className={cx("twoGrid")}><button className={cx("sheetPill")} data-on={!!selected?.mirror} onClick={() => updateClip({ mirror: !selected?.mirror })}><Icon name="mirror" size={17} /> Mirror</button><button className={cx("sheetPill")} onClick={() => updateClip({ zoom: 1, mirror: false })}>Reset</button></div></Shell>;
  if (s.sheet === "ratio") return <Shell title="Ratio" sub="Frame for the whole video"><div className={cx("ratioGrid")}>{(Object.keys(RATIOS) as Ratio[]).map(ratio => <button key={ratio} data-on={s.ratio === ratio} onClick={() => { if (s.ratio !== ratio) s.edit({ ratio }); }}><i data-ratio={ratio} /><span>{ratio}</span></button>)}</div></Shell>;
  if (s.sheet === "fx") {
    const selectedFx = s.fxScope === "camera" ? s.liveFx : s.fxScope === "clip" ? selected?.fx : s.clips.every(c => c.fx === s.clips[0]?.fx) ? s.clips[0]?.fx : -1;
    const title = s.fxScope === "camera" ? "Effects" : s.fxScope === "clip" ? "Filter" : "Filters";
    const sub = s.fxScope === "camera" ? "Live filter for new clips" : s.fxScope === "clip" ? `Clip ${s.sel + 1}` : "Applies to every clip";
    const change = (fx: number) => {
      if (s.fxScope === "camera") s.patch({ liveFx: fx });
      else if (s.fxScope === "clip") updateClip({ fx });
      else s.edit({ clips: s.clips.map(clip => ({ ...clip, fx })) });
    };
    return <Shell title={title} sub={sub}><div className={cx("fxGrid")}>{FX.map((fx, index) => <button key={fx.name} data-on={selectedFx === index} onClick={() => change(index)}><i style={{ filter: fx.css }} /><span>{fx.name}</span></button>)}</div></Shell>;
  }
  if (s.sheet === "sound") return <Shell title="Sound" sub="Pick a track for this video"><div className={cx("soundList")}>{SOUNDS.map((sound, index) => <button key={sound.name} data-on={s.sound === index} onClick={() => { if (s.sound !== index) s.edit({ sound: index }); previewSound(index); s.notify(index ? `♪ ${sound.name}` : "Original sound"); }}><i style={{ background: sound.color }}><Icon name="music" size={16} /></i><span><strong>{sound.name}</strong><small>{sound.by}</small></span><em>{sound.len}</em>{s.sound === index && <b><Icon name="check" size={15} /></b>}</button>)}</div></Shell>;
  return <Shell title="Start over?" sub={`This removes all ${s.clips.length} clips.`}><div className={cx("discardGrid")}><button onClick={() => s.patch({ sheet: null })}>Keep</button><button onClick={() => s.reset()}>Discard</button></div></Shell>;
}
