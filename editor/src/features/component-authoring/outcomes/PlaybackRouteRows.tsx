import { useState } from "react";
import { total } from "../../../domain/clips/timing";
import type { PlaybackOutcome,Scene } from "../../../domain/project/model";
import { cx } from "../../../styles";
import { Icon } from "../../../ui/Icon";
import { fmt } from "../../../ui/formatTime";
import styles from "./SceneChoices.module.css";

export function PlaybackRouteRows({ selected, pick, scene, others, playheadTime, onUsePlayhead, onNewScene, allowNoAction = false }: {
  selected: PlaybackOutcome | null | undefined;
  pick: (outcome: PlaybackOutcome | null) => void;
  scene: Scene | undefined;
  others: Scene[];
  playheadTime: () => number;
  onUsePlayhead: () => void;
  onNewScene: () => void;
  allowNoAction?: boolean;
}) {
  const [sceneOpen, setSceneOpen] = useState(false);
  return <div className={cx("outcomeRows")} role="group" aria-label="Viewer action">
    {allowNoAction && <button className={cx("outcomeRow")} data-on={selected == null} onClick={() => pick(null)}><i>{selected == null && <Icon name="check" size={13} />}</i><span><strong>Do nothing</strong><small>Leave the component open so the viewer can try again</small></span></button>}
    <button className={cx("outcomeRow")} data-on={selected?.kind === "continue"} onClick={() => pick({ kind: "continue" })}><i>{selected?.kind === "continue" && <Icon name="check" size={13} />}</i><span><strong>Continue video</strong><small>Keeps playing from here</small></span></button>
    <div className={cx("outcomeRow")} data-on={selected?.kind === "time"}><button className={cx("outcomeMain")} onClick={() => pick({ kind: "time", t: selected?.kind === "time" ? selected.t : playheadTime() })}><i>{selected?.kind === "time" && <Icon name="check" size={13} />}</i><span><strong>Jump to a point</strong><small>Skips to {selected?.kind === "time" ? fmt(selected.t) : fmt(playheadTime())} in this scene</small></span></button><button className={cx("outcomePlayhead")} onClick={onUsePlayhead}>Pick on timeline</button></div>
    <button className={cx("outcomeRow")} data-on={selected?.kind === "scene"} onClick={() => setSceneOpen(true)}><i>{selected?.kind === "scene" && <Icon name="check" size={13} />}</i><span><strong>Go to a scene</strong><small>Plays another scene to its end</small></span></button>
    {(sceneOpen || selected?.kind === "scene") && <div className={`sceneChoices ${styles.choices}`} aria-label="Scene destinations">
      {others.map(item => {
        const parent = [scene, ...others].find(candidate => candidate?.id === item.parent);
        const clip = item.clips[0];
        return <button key={item.id} type="button" className={styles.card}
          aria-pressed={selected?.kind === "scene" && selected.sceneId === item.id}
          onClick={() => pick({ kind: "scene", sceneId: item.id })}>
          <span className={styles.preview} style={{ background: clip?.color ?? "var(--surface)" }} aria-hidden="true">
            {clip?.url ? <video src={`${clip.url}#t=${clip.in.toFixed(1)}`} muted playsInline preload="metadata" /> : <Icon name="play" size={15} />}
          </span>
          <span className={styles.copy}><strong>{item.name} <small>{fmt(total(item.clips))}</small></strong>
            <span>{item.id === "main" ? "top level" : `branch of ${parent?.name ?? "Main"}`}</span>
          </span>
        </button>;
      })}
      <button type="button" className={styles.newScene} onClick={onNewScene}>＋ New scene</button>
    </div>}
  </div>;
}
