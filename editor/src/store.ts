import { create } from "zustand";
import { clamp } from "./lib/format";
import { total } from "./lib/timeline";

export type Clip = { id: number; url: string | null; color: string; srcDur: number; in: number; out: number; speed: number; fx: number; zoom: number; mirror: boolean };
export type TextOverlay = { id: number; text: string; color: number; start: number; end: number; x: number; y: number };
export type Ratio = "9:16" | "1:1" | "4:5" | "16:9";
export type SheetName = null | "speed" | "crop" | "ratio" | "text" | "fx" | "sound" | "export" | "discard";
type Snapshot = { clips: Clip[]; texts: TextOverlay[]; ratio: Ratio; muted: boolean; sound: number };

export const CLIP_COLORS = ["#FF758F", "#A78BFA", "#2EC4B6", "#FFD23E"];
export const FX = [
  { name: "None", css: "none" },
  { name: "Warm", css: "sepia(.35) saturate(1.45) hue-rotate(-8deg)" },
  { name: "Mono", css: "grayscale(1) contrast(1.12)" },
  { name: "Pop", css: "saturate(1.8) contrast(1.08)" },
  { name: "Cool", css: "hue-rotate(-18deg) saturate(1.15) brightness(1.05)" },
];
export const RATIOS: Record<Ratio, [number, number]> = { "9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5], "16:9": [16, 9] };
export const TEXT_COLORS = [
  { bg: "#F2F0E9", fg: "#111" }, { bg: "#FF2D78", fg: "#F2F0E9" }, { bg: "#FFD23E", fg: "#111" },
  { bg: "#2EC4B6", fg: "#111" }, { bg: "#111117", fg: "#F2F0E9" },
];
export const SOUNDS = [
  { name: "Original sound", by: "From your clips", len: "", color: "#F2F0E9" },
  { name: "Summer Groove", by: "Lo-Fi Lab", len: "0:30", color: "#FF758F" },
  { name: "Night Drive", by: "Neon Tapes", len: "0:24", color: "#A78BFA" },
  { name: "Hype Mode", by: "Beatsmith", len: "0:15", color: "#FFD23E" },
  { name: "Soft Focus", by: "Paper Moon", len: "0:40", color: "#2EC4B6" },
];
let nextId = 1;
export const uid = () => nextId++;
export const mkClip = (length: number, url: string | null, index: number): Clip => ({
  id: uid(), url, color: CLIP_COLORS[index % CLIP_COLORS.length], srcDur: length,
  in: 0, out: length, speed: 1, fx: 0, zoom: 1, mirror: false,
});

export type CaptureState = {
  screen: "camera" | "editor"; mode: 15 | 60 | 180; recording: boolean; elapsed: number; camOn: boolean;
  facing: "user" | "environment"; flash: boolean; timer: 0 | 3 | 10; countdown: number;
  recSpeed: .3 | .5 | 1 | 2 | 3; speedRow: boolean; liveFx: number; replacing: number | null;
  clips: Clip[]; texts: TextOverlay[]; ratio: Ratio; muted: boolean; sound: number;
  sel: number; t: number; playing: boolean; trim: { i: number; side: "l" | "r"; shift: number; lt: number } | null; orb: boolean;
  sheet: SheetName; draft: string; tColor: number; fxScope: "camera" | "clip" | "all";
  quality: "720p" | "1080p"; ex: "idle" | "running" | "done"; exPct: number; exUrl: string | null; exName: string;
  toast: string; past: Snapshot[]; future: Snapshot[];
  patch: (values: Partial<CaptureState>) => void;
  edit: (values: Partial<Snapshot> & Partial<CaptureState>) => void;
  undo: () => void; redo: () => void; reset: () => void; notify: (message: string) => void;
};

const base = {
  screen: "camera" as const, mode: 15 as const, recording: false, elapsed: 0, camOn: false,
  facing: "user" as const, flash: false, timer: 0 as const, countdown: 0,
  recSpeed: 1 as const, speedRow: false, liveFx: 0, replacing: null,
  clips: [] as Clip[], texts: [] as TextOverlay[], ratio: "9:16" as Ratio, muted: false, sound: 0,
  sel: -1, t: 0, playing: false, trim: null, orb: false,
  sheet: null, draft: "", tColor: 2, fxScope: "camera" as const,
  quality: "720p" as const, ex: "idle" as const, exPct: 0, exUrl: null, exName: "", toast: "",
  past: [] as Snapshot[], future: [] as Snapshot[],
};
const snapshot = (s: CaptureState): Snapshot => ({ clips: s.clips.map(c => ({ ...c })), texts: s.texts.map(t => ({ ...t })), ratio: s.ratio, muted: s.muted, sound: s.sound });
let toastTimer: number | undefined;
export const useCapture = create<CaptureState>((set, get) => ({
  ...base,
  patch: (values) => set(values),
  edit: (values) => set(s => ({ ...values, past: [...s.past, snapshot(s)].slice(-40), future: [] })),
  undo: () => set(s => {
    if (!s.past.length) return s;
    const old = s.past[s.past.length - 1];
    return { ...old, past: s.past.slice(0, -1), future: [snapshot(s), ...s.future].slice(0, 40), playing: false,
      t: clamp(s.t, 0, total(old.clips)), sel: old.clips.length ? Math.min(s.sel, old.clips.length - 1) : -1,
      screen: old.clips.length ? s.screen : "camera" };
  }),
  redo: () => set(s => {
    if (!s.future.length) return s;
    const next = s.future[0];
    return { ...next, past: [...s.past, snapshot(s)].slice(-40), future: s.future.slice(1), playing: false,
      t: clamp(s.t, 0, total(next.clips)), sel: next.clips.length ? Math.min(s.sel, next.clips.length - 1) : -1,
      screen: next.clips.length ? s.screen : "camera" };
  }),
  reset: () => {
    get().clips.forEach(c => { if (c.url) URL.revokeObjectURL(c.url); });
    if (get().exUrl) URL.revokeObjectURL(get().exUrl!);
    set({ ...base, camOn: get().camOn, facing: get().facing });
    get().notify("Cleared");
  },
  notify: (message) => {
    clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = window.setTimeout(() => set({ toast: "" }), 1600);
  },
}));
