import type { CSSProperties } from "react";
import { audioDuration } from "../../domain/audio/editing";
import type { AudioClip } from "../../domain/audio/model";
import type { useLayerDrag } from "../timeline/useLayerDrag";
import type { TimingSnapSettings } from "../timeline/timingSnap";
import { TimelineAudioBar } from "./TimelineAudioBar";

export function AudioClipBar({
  clip,
  ...props
}: {
  clip: AudioClip;
  pixelsPerSecond: number;
  snap?: TimingSnapSettings;
  style?: CSSProperties;
  layerDrag?: ReturnType<typeof useLayerDrag>;
}) {
  return (
    <TimelineAudioBar
      {...props}
      layer={{
        id: `audio:${clip.id}`,
        type: "audio",
        label: clip.name,
        start: clip.start,
        end: clip.start + audioDuration(clip),
        visual: false,
        value: clip,
      }}
    />
  );
}
