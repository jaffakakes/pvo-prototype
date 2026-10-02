import {
  extractSelectedAudio,
  deleteSelectedAudio,
  splitSelectedAudio,
  duplicateSelectedAudio,
  updateSelectedAudio,
} from "../../state/editing/audioCommands";
import { locate } from "../../domain/clips/timing";
import { useCapture } from "../../state/captureStore";
import { clearSelection } from "../../state/editing/clearSelection";
import { useAssistant } from "../../state/assistant/assistantStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { deleteSelectedClip, splitAtPlayhead } from "./clipCommands";
import { acceptPlayheadPick, cancelPlayheadPick } from "./playheadPick";
import styles from "./ToolRow.module.css";

export function ToolRow() {
  const playheadPick = useCapture((state) => state.playheadPick);
  const sel = useCapture((state) => state.sel);
  const selComp = useCapture((state) => state.selComp);
  const selText = useCapture((state) => state.selText);
  const clips = useCapture((state) => state.clips);
  const selectedAudio = useCapture((state) =>
    state.audioClips.find((clip) => clip.id === state.selAudio),
  );
  const components = useCapture((state) => state.components);
  const texts = useCapture((state) => state.texts);
  const trying = useCapture((state) => state.tryMode !== null);
  const assistantActive = useAssistant((state) => state.phase !== "idle");
  const playhead = useCapture((state) => state.t);
  if (playheadPick) {
    return (
      <div className={cx("toolBar")} data-time-pick="true">
        {playheadPick.error && (
          <p className={styles.pickError} role="alert">
            {playheadPick.error}
          </p>
        )}
        <div
          className={`${cx("tools playheadPickTools")} ${styles.pickTools}`}
          role="group"
          aria-label="Choose playhead time"
        >
          <span className={styles.pickQuestion}>
            {playheadPick.kind === "outcome-time"
              ? "Jump to when?"
              : "Appears when?"}
          </span>
          <button
            className={cx("tool playheadPickTool")}
            type="button"
            autoFocus
            onClick={cancelPlayheadPick}
          >
            Cancel
          </button>
          <button
            className={cx("tool playheadPickTool playheadPickAccept")}
            type="button"
            onClick={acceptPlayheadPick}
          >
            Use {fmt(playhead)}
          </button>
        </div>
      </div>
    );
  }
  const selected = sel >= 0 ? clips[sel] : null;
  const selectedComp = components.find((component) => component.id === selComp);
  const selectedText = texts.find((text) => text.id === selText);
  const action = (name: string) => {
    const s = useCapture.getState();
    const selected = s.sel >= 0 ? s.clips[s.sel] : null;
    const selectedComp = s.components.find(
      (component) => component.id === s.selComp,
    );
    const selectedText = s.texts.find((text) => text.id === s.selText);
    if (name === "extractAudio") extractSelectedAudio();
    else if (name === "audioSplit") splitSelectedAudio();
    else if (name === "audioDelete") deleteSelectedAudio();
    else if (name === "audioDuplicate") duplicateSelectedAudio();
    else if (name === "audioMute" && selectedAudio)
      updateSelectedAudio({ muted: !selectedAudio.muted });
    else if (["textCollapse", "compCollapse", "collapse"].includes(name))
      clearSelection();
    else if (name === "textEdit") s.patch({ sheet: "text", playing: false });
    else if (name === "animation") s.patch({ sheet: "animation", playing: false, orb: false });
    else if (name === "textDuplicate" && selectedText)
      s.duplicateText(selectedText.id);
    else if (name === "textDelete" && selectedText)
      s.deleteText(selectedText.id);
    else if (name === "compEdit")
      s.patch({ sheet: "component", playing: false, orb: false });
    else if (name === "compDuplicate" && selectedComp)
      s.duplicateComponent(selectedComp.id);
    else if (name === "compDelete" && selectedComp)
      s.deleteComponent(selectedComp.id);
    else if (name === "components")
      s.patch({ sheet: "components", playing: false, orb: false });
    else if (name === "edit") {
      const loc = locate(s.t, s.clips);
      if (loc)
        s.patch({ sel: loc.i, selComp: null, selText: null, orb: false });
    } else if (name === "split") splitAtPlayhead(s);
    else if (name === "replace" && selected)
      s.patch({
        replacing: selected.id,
        screen: "camera",
        sel: -1,
        playing: false,
      });
    else if (name === "delete") deleteSelectedClip(s);
    else if (name === "more")
      s.patch({ sheet: "more", ratioMenu: false, playing: false, orb: false });
    else
      s.patch({
        sheet: name as CaptureStateSheet,
        ...(name === "text" ? { selText: null, draft: "" } : {}),
        playing: false,
        orb: false,
      });
  };
  type CaptureStateSheet = "text" | "sound" | "speed" | "crop";
  const componentName = selectedComp
    ? selectedComp.type[0].toUpperCase() + selectedComp.type.slice(1)
    : "";
  const tools = selectedComp
    ? [
        ["down", componentName, "compCollapse"],
        ["edit", "Edit", "compEdit"],
        ["keyframe", "Animate", "animation"],
        ["plus", "Duplicate", "compDuplicate"],
        ["delete", "Delete", "compDelete"],
      ]
    : selected
      ? [
          ["down", "", "collapse"],
          ["split", "Split", "split"],
          ["replace", "Replace", "replace"],
          ["delete", "Delete", "delete"],
          ["speed", "Speed", "speed"],
          ["crop", "Crop", "crop"],
          ["keyframe", "Animate", "animation"],
          ...(!selected.audioDetached && selected.url
            ? [["music", "Extract audio", "extractAudio"]]
            : []),
        ]
      : [
          ["edit", "Edit clip", "edit"],
          ["text", "Text", "text"],
          ["components", "Components", "components"],
          ["music", "Sound", "sound"],
          ["more", "More", "more"],
        ];
  const activeTools = selectedAudio
    ? [
        ["down", "", "collapse"],
        ["split", "Split", "audioSplit"],
        ["plus", "Duplicate", "audioDuplicate"],
        ["keyframe", "Animate", "animation"],
        [
          selectedAudio.muted ? "muted" : "music",
          selectedAudio.muted ? "Unmute" : "Mute",
          "audioMute",
        ],
        ["delete", "Delete", "audioDelete"],
      ]
    : selectedText
      ? [
          ["down", "", "textCollapse"],
          ["edit", "Edit text", "textEdit"],
          ["keyframe", "Animate", "animation"],
          ["plus", "Duplicate", "textDuplicate"],
          ["delete", "Delete", "textDelete"],
        ]
      : tools;
  const toolSet = selectedAudio
    ? "audio"
    : selectedText
      ? "text"
      : selectedComp
        ? "component"
        : selected
          ? "clip"
          : "main";
  return (
    <div
      className={`${cx("toolBar")} ${styles.assistantToolbar}`}
      data-trying={trying}
      aria-hidden={assistantActive || undefined}
    >
      {!assistantActive && (
        <div key={toolSet} className={cx("tools")}>
          {activeTools.map(([icon, label, name]) => (
            <button
              key={name}
              className={cx(`tool tool-${name}`)}
              onClick={() => action(name)}
              disabled={trying}
              aria-label={
                name === "compCollapse"
                  ? "Collapse component tools"
                  : label ||
                    (selectedText
                      ? "Collapse text tools"
                      : "Collapse clip tools")
              }
            >
              <Icon name={icon} size={20} />
              {label && <span>{label}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
