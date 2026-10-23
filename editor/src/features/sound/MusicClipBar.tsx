import type { CSSProperties } from "react";
import type { MusicLayer } from "../../domain/audio/music";
import type { useLayerDrag } from "../timeline/useLayerDrag";
import type { TimingSnapSettings } from "../timeline/timingSnap";
import { TimelineAudioBar } from "./TimelineAudioBar";
import { SOUNDS } from "./catalog";

export function MusicClipBar({
  music,
  ...props
}: {
  music: MusicLayer;
  pixelsPerSecond: number;
  snap?: TimingSnapSettings;
  style?: CSSProperties;
  layerDrag?: ReturnType<typeof useLayerDrag>;
}) {
  return (
    <TimelineAudioBar
      {...props}
      layer={{
        id: "music",
        type: "music",
        label: SOUNDS[music.track]?.name ?? "Music",
        start: music.start,
        end: music.start + music.duration,
        visual: false,
        value: music,
      }}
    />
  );
}
