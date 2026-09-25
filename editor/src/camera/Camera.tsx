import { useEffect, useRef } from "react";
import { Icon } from "../lib/icons";
import { clamp, fmt, round2 } from "../lib/format";
import { total } from "../lib/timeline";
import { FX, mkClip, SOUNDS, useCapture } from "../store";
import { getCameraStream, useCamera } from "./useCamera";
import { useRecorder } from "./useRecorder";

async function videoDuration(url: string) {
  const video = document.createElement("video");
  video.preload = "metadata";
  video.src = url;
  await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = reject; });
  return Number.isFinite(video.duration) ? video.duration : 3;
}

export function Camera() {
  const s = useCapture();
  const { videoRef, startCam } = useCamera();
  const { onShutterDown, onShutterUp } = useRecorder();
  const uploadRef = useRef<HTMLInputElement>(null);
  const activeClips = s.clips.filter(c => c.id !== s.replacing);
  const used = total(activeClips);
  const live = s.recording ? s.elapsed : 0;
  const pct = clamp((used + live) / s.mode, 0, 1);
  const last = s.clips.at(-1);
  const count = s.clips.length;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || useCapture.getState().sheet) return;
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      onShutterDown({ button: 0 });
      onShutterUp();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onShutterDown, onShutterUp]);

  const upload = async (files: FileList | null) => {
    if (!files) return;
    const initial = useCapture.getState();
    let clips = [...initial.clips];
    let replaced = false;
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      try {
        const duration = await videoDuration(url);
        const replacingIndex = !replaced && initial.replacing != null ? clips.findIndex(c => c.id === initial.replacing) : -1;
        const room = initial.mode - total(replacingIndex >= 0 ? clips.filter((_, i) => i !== replacingIndex) : clips);
        if (room <= .3) { URL.revokeObjectURL(url); s.notify("Time's up — open the editor"); break; }
        const clip = mkClip(round2(Math.min(duration, room)), url, clips.length);
        if (replacingIndex >= 0) { clip.color = clips[replacingIndex].color; clips[replacingIndex] = clip; replaced = true; }
        else clips.push(clip);
      } catch { URL.revokeObjectURL(url); s.notify("Couldn't read that file"); }
    }
    if (clips.length !== initial.clips.length || replaced) {
      const index = replaced ? initial.clips.findIndex(c => c.id === initial.replacing) : -1;
      s.edit({ clips, replacing: replaced ? null : initial.replacing, screen: replaced ? "editor" : "camera", sel: index, t: replaced ? total(clips.slice(0, index)) : s.t });
    }
    if (uploadRef.current) uploadRef.current.value = "";
  };

  const removeLast = () => {
    if (!s.clips.length) return;
    s.edit({ clips: s.clips.slice(0, -1) });
    s.notify("Last clip removed");
  };

  const flip = () => {
    if (s.recording) return;
    s.patch({ facing: s.facing === "user" ? "environment" : "user" });
  };

  const toggleFlash = async () => {
    const next = !s.flash;
    const track = getCameraStream()?.getVideoTracks()[0];
    try {
      if (track) await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      s.patch({ flash: next });
      s.notify(next ? "Flash on" : "Flash off");
    } catch { s.notify("Flash isn't available on this camera"); }
  };

  const startOver = () => {
    if (s.recording) return;
    if (s.replacing != null) { s.patch({ replacing: null, screen: "editor" }); return; }
    if (s.clips.length) s.patch({ sheet: "discard" });
    else s.notify("Nothing to discard yet");
  };

  const changeMode = (mode: 15 | 60 | 180) => {
    if (s.recording) return;
    if (used > mode) s.notify("Your clips are longer than that");
    else s.patch({ mode });
  };

  const hint = s.countdown ? "Tap to cancel" : s.recording ? "Release or tap to stop" : s.replacing != null ? "Record the new take" : count ? "Tap or hold to add another clip" : "Tap or hold to record";

  return <>
    <div className="camWrap">
      <div className="viewfinder">
        {s.camOn ? <video ref={videoRef} className="live" autoPlay muted playsInline style={{ transform: s.facing === "user" ? "scaleX(-1)" : undefined, filter: FX[s.liveFx].css }} /> :
          <div className="fallback" style={{ filter: FX[s.liveFx].css }}><span className="fallbackIco"><Icon name="camera" size={30} /></span><h2>Camera is off</h2><p>Allow access to record, or tap the shutter to make demo clips.</p><button className="press" onClick={startCam}>Allow camera</button></div>}
        <div className="topScrim" />
        <div className="camTop"><div className="segbar" aria-label={`${fmt(used + live)} of ${fmt(s.mode)} recorded`}>
          {activeClips.map(c => <span key={c.id} className="seg" style={{ width: `${Math.max(0, (c.out - c.in) / c.speed / s.mode * 100)}%` }} />)}
          {s.recording && <span className="seg segLive" style={{ width: `${live / s.mode * 100}%` }} />}
        </div><div className="recLine">{s.recording && <span className="recPill"><i />REC {fmt(live)}</span>}<span className="timeNote">{fmt(used + live)} / {fmt(s.mode)}</span></div></div>
        <div className="camControls"><button className="sq42" onClick={startOver} aria-label="Start over" title="Start over" style={{ opacity: !count && s.replacing == null ? .5 : 1 }}><Icon name="close" /></button>
          <button className="soundPill" onClick={() => s.patch({ sheet: "sound" })}><Icon name="music" size={15} /> <span>{s.sound ? SOUNDS[s.sound].name : "Add sound"}</span></button>
          <button className="sq42" onClick={flip} aria-label="Flip camera" title="Flip camera"><Icon name="flip" /></button></div>
        <div className="rightRail">
          <button className="rail" data-on={s.flash} onClick={toggleFlash} aria-label="Flash" title="Flash"><Icon name="flash" size={18} /></button>
          <button className="rail" data-on={s.timer > 0} onClick={() => { if (s.recording) return; const timer = s.timer === 0 ? 3 : s.timer === 3 ? 10 : 0; s.patch({ timer }); s.notify(timer ? `Timer ${timer}s` : "Timer off"); }} aria-label="Timer" title="Timer"><Icon name="timer" size={18} />{s.timer > 0 && <span className="railBadge">{s.timer}s</span>}</button>
          <button className="rail" data-on={s.speedRow || s.recSpeed !== 1} onClick={() => { if (!s.recording) s.patch({ speedRow: !s.speedRow }); }} aria-label="Speed" title="Speed"><Icon name="speed" size={18} /></button>
          <button className="rail" data-on={s.liveFx > 0} onClick={() => s.patch({ sheet: "fx", fxScope: "camera" })} aria-label="Filters" title="Filters"><Icon name="filters" size={18} /></button>
        </div>
        {s.replacing != null && <div className="replacing">Replacing clip {s.clips.findIndex(c => c.id === s.replacing) + 1}<button onClick={() => s.patch({ replacing: null, screen: "editor" })} aria-label="Cancel replace"><Icon name="close" size={12} /></button></div>}
        {!!last && !s.recording && s.replacing == null && <button className="dock" onClick={() => s.patch({ screen: "editor", sel: -1, t: 0 })} aria-label="Open editor"><span className="dockThumb" style={{ background: last.color }}>
          {last.url && <video src={`${last.url}#t=${last.in.toFixed(1)}`} muted playsInline style={{ filter: FX[last.fx].css, transform: last.mirror ? "scaleX(-1)" : undefined }} />}
          <span className="dockEdit">EDIT</span><span className="dockCount">{count}</span></span><span className="dockCaption">Open editor</span></button>}
        <div className="camBottom">
          {s.speedRow && !s.recording && <div className="speedRow">{([.3, .5, 1, 2, 3] as const).map(speed => <button key={speed} data-on={s.recSpeed === speed} onClick={() => s.patch({ recSpeed: speed, speedRow: false })}>{speed}x</button>)}</div>}
          <div className="modeRow">{([15, 60, 180] as const).map(mode => <button key={mode} data-on={s.mode === mode} data-disabled={used > mode} onClick={() => changeMode(mode)}>{mode === 15 ? "15s" : mode === 60 ? "1m" : "3m"}</button>)}</div>
          <div className="shutterRow"><button className="sideAction" onClick={() => count && s.replacing == null ? removeLast() : uploadRef.current?.click()} aria-label={count && s.replacing == null ? "Undo last take" : "Upload video"}><span className="side50 press"><Icon name={count && s.replacing == null ? "undoTake" : "upload"} size={22} /></span><span className="sideLabel">{count && s.replacing == null ? "Undo" : "Upload"}</span></button>
            <button className="shutter" data-rec={s.recording} onPointerDown={onShutterDown} onPointerUp={onShutterUp} onPointerCancel={onShutterUp} aria-label={s.recording ? "Stop recording" : "Record"}><span className="ring" /><svg width="88" height="88" viewBox="0 0 88 88"><circle cx="44" cy="44" r="41" fill="none" stroke="#FF9FBC" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${pct * (2 * Math.PI * 41)} ${2 * Math.PI * 41}`} transform="rotate(-90 44 44)" /></svg><span className="core" /></button>
            <button className="sideAction" onClick={() => s.patch({ sheet: "fx", fxScope: "camera" })}><span className="side50 press"><Icon name="sparkle" size={22} /></span><span className="sideLabel">{s.liveFx ? FX[s.liveFx].name : "Effects"}</span></button></div>
          <span className="camHint">{hint}</span>
        </div>
        {s.countdown > 0 && <div className="countdown" aria-live="assertive">{s.countdown}</div>}
      </div>
    </div>
    <footer className="camFoot"><span className="brand"><span className="brandMark"><img src="restyle-mark.png" alt="" /></span><span>restyle</span></span><span>{count ? `${count} clip${count === 1 ? "" : "s"} · ${fmt(total(s.clips))}` : "No clips yet"}</span></footer>
    <input ref={uploadRef} type="file" accept="video/*" multiple hidden onChange={e => upload(e.target.files)} />
  </>;
}
