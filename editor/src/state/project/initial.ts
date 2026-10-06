import { type LayerId } from "../../domain/layers/model";
import type { ProjectSnapshot, Ratio } from "../../domain/project/model";
import { mainScene } from "../../domain/scenes/rules";

export const initial = () => {
  const main = mainScene();
  return {
    localId: null as string | null, projectName: "Untitled edit",
    screen: "camera" as const, recording: false, importing: false, elapsed: 0, camOn: false,
    facing: "user" as const, flash: false, timer: 0 as const, countdown: 0,
    recSpeed: 1 as const, speedRow: false, replacing: null,
    scenes: [main], currentSceneId: main.id,
    clips: main.clips, audioClips: [], texts: main.texts, components: main.components, muted: main.muted, sound: main.sound,
    ratio: "9:16" as Ratio, coverAt: 0, allowedDomains: [], recordingInto: null,
    layers: ["video"] as LayerId[], sel: -1, selComp: null, selText: null, selAudio: null, t: 0, playing: false, trim: null, orb: false, tryMode: null, playheadPick: null,
    sheet: null, ratioMenu: false, draft: "", tColor: 2,
    exportFormat: "pvo" as const,
    quality: "1080p" as const, ex: "idle" as const, exPct: 0, exUrl: null, exName: "",
    past: [] as ProjectSnapshot[], future: [] as ProjectSnapshot[],
  };
};
