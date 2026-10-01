import { useState } from "react";
import { useWideLayout } from "../../../infrastructure/viewport";
import type { OutcomeTarget, PlaybackOutcome, PvoComponent } from "../../../domain/project/model";
import { clamp } from "../../../domain/project/numbers";
import { sceneDuration } from "../../../domain/scenes/duration";
import { useCapture } from "../../../state/captureStore";
import { createRoutedScene } from "../../../state/scenes/sceneRoutingCommands";
import { beginPlayheadPick } from "../../timeline/playheadPick";
import { PlaybackRouteRows } from "./PlaybackRouteRows";
import styles from "../NoCodeEditor.module.css";

function routeName(outcome: PlaybackOutcome | null | undefined): string {
  if (!outcome) return "Try again";
  if (outcome.kind === "continue") return "Continue video";
  if (outcome.kind === "time") return "Jump to a point";
  return "Go to a scene";
}

/** The same playback choices serve simple actions and Advanced request branches. */
export function ActionRow({ component, label, detail, outcome, target, branch, onChange, initiallyOpen = false }: {
  component: PvoComponent;
  label: string;
  detail?: string;
  outcome: PlaybackOutcome | null | undefined;
  target: OutcomeTarget;
  branch?: "success" | "error";
  onChange: (value: PlaybackOutcome, undoable?: boolean) => boolean | void;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [error, setError] = useState(false);
  const wide = useWideLayout();
  const scenes = useCapture(state => state.scenes);
  const scene = scenes.find(item => item.id === component.sceneId);
  const playheadTime = () => clamp(
    useCapture.getState().t,
    0,
    scene ? sceneDuration(scene) : 0,
  );
  return <div className={styles.action}>
    <button type="button" className={styles.actionToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
      <span>{label}{detail && <small>{detail}</small>}</span>
      <b>{routeName(outcome)} {open ? "−" : "+"}</b>
    </button>
    {open && <PlaybackRouteRows selected={outcome}
      pick={value => setError(onChange(value ?? { kind: "continue" }) === false)} scene={scene}
      others={scenes.filter(item => item.id !== component.sceneId)} playheadTime={playheadTime}
      onUsePlayhead={() => beginPlayheadPick({ kind: "outcome-time", componentId: component.id, target, branch: branch ?? null })}
      onNewScene={() => setError(createRoutedScene(component.id, target, branch, { openCamera: !wide }) === null)} />}
    {error && <p className={styles.error} role="alert">Fix this action’s Logic in Advanced first.</p>}
  </div>;
}
