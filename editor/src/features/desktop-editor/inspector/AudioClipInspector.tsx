import { audioDuration } from "../../../domain/audio/editing";
import type { AudioClip } from "../../../domain/audio/model";
import { updateSelectedAudio } from "../../../state/editing/audioCommands";
import { InspectorSections } from "./InspectorControls";

export function AudioClipInspector({ clip }: { clip: AudioClip }) {
  return (
    <InspectorSections
      sections={[
        {
          title: "Extracted audio",
          controls: [
            {
              kind: "toggle",
              label: "Mute audio",
              on: clip.muted,
              onToggle: () => updateSelectedAudio({ muted: !clip.muted }),
            },
            {
              kind: "list",
              rows: [
                { label: "Starts", value: `${clip.start.toFixed(2)}s` },
                {
                  label: "Duration",
                  value: `${audioDuration(clip).toFixed(2)}s`,
                },
              ],
            },
            {
              kind: "note",
              text: "Drag to move. Drag either edge to trim. Video edits leave this audio in place.",
            },
          ],
        },
      ]}
    />
  );
}
