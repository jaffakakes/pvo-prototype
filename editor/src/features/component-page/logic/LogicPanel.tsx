import { useRef, useState } from "react";
import { fieldsShownFor } from "../../../domain/components/fields";
import { formSubmissionOutcome } from "../../../domain/components/forms";
import type {
  OutcomeTarget,
  PlaybackOutcome,
  PvoComponent,
} from "../../../domain/project/model";
import { sceneDuration } from "../../../domain/scenes/duration";
import { useCapture } from "../../../state/captureStore";
import { createRoutedScene } from "../../../state/scenes/sceneRoutingCommands";
import { Icon } from "../../../ui/Icon";
import { pickTime } from "../../../ui/formatTime";
import { FrameFilmstrip } from "../../frame-picker/FrameFilmstrip";
import { FormReplyCollection } from "../../component-authoring/outcomes/FormReplyCollection";
import { ComponentTiming } from "./ComponentTiming";
import { MoreOptions } from "./MoreOptions";
import styles from "../ComponentPage.module.css";

type Screen = "behaviour" | "save" | "after" | "timing" | "more";
export function LogicPanel({
  component,
  control,
  onCode,
}: {
  component: PvoComponent;
  control: number | null;
  onCode(): void;
}) {
  const [screen, setScreen] = useState<Screen>("behaviour");
  const [choice, setChoice] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState(false);
  const edited = useRef(false);
  const scenes = useCapture((state) => state.scenes);
  const scene = scenes.find((item) => item.id === component.sceneId);
  const fields = fieldsShownFor(component);
  const isForm = component.type === "form";
  const collecting = isForm && fields.formSubmitMode === "collect";
  const item = (
    component.type === "choice" ? fields.options : fields.buttons
  )?.[control ?? 0];
  const target: OutcomeTarget = isForm
    ? { kind: "form" }
    : {
        kind: component.type === "choice" ? "option" : "button",
        index: control ?? 0,
      };
  const outcome = isForm
    ? collecting
      ? fields.successOutcome
      : formSubmissionOutcome({ id: component.id, fields })
    : item?.outcome;
  const request = outcome?.kind === "request";
  const selected =
    choice ?? (collecting ? "collect" : (outcome?.kind ?? "continue"));
  const label = isForm ? fields.submitLabel || "Send" : item?.label || "Button";
  const apply = (value: PlaybackOutcome, undoable = true) => {
    const state = useCapture.getState();
    if (collecting && (screen === "after" || selected === "collect")) {
      state.updateComponent(
        component.id,
        { fields: { ...fields, successOutcome: value } },
        undoable,
      );
      setError(false);
      return true;
    }
    const success = state.updateOutcome(component.id, target, value, undoable);
    setError(!success);
    return success;
  };
  const choose = (id: string) => {
    if (id === "request") {
      onCode();
      return;
    }
    if (id === "collect") {
      setChoice(id);
      return;
    }
    if (id === "scene") {
      setChoice(id);
      return;
    }
    const value: PlaybackOutcome =
      id === "time"
        ? { kind: "time", t: outcome?.kind === "time" ? outcome.t : 0 }
        : { kind: "continue" };
    // Choosing another behaviour leaves collection through the same action command.
    const success =
      screen !== "after"
        ? useCapture.getState().updateOutcome(component.id, target, value)
        : apply(value);
    setError(!success);
    if (success) setChoice(id);
  };
  const title =
    screen === "save"
      ? "Save answers to"
      : screen === "after"
        ? "After saving"
        : screen === "timing"
          ? "Appears"
          : screen === "more"
            ? "More options"
            : control === null
              ? `Whole ${isForm ? "form" : component.type === "card" ? "message" : component.type === "tooltip" ? "note" : "choice"}`
              : `When someone ${isForm ? "submits" : "taps"} ${label}`;
  const behaviours = [
    ...(isForm && screen !== "after"
      ? [{ id: "collect", label: "Collect answers", icon: "form" }]
      : []),
    { id: "continue", label: "Continue video", icon: "play" },
    { id: "time", label: "Jump to a point", icon: "reset" },
    { id: "scene", label: "Go to a scene", icon: "choice" },
    ...(screen !== "after"
      ? [{ id: "request", label: "Send to a URL", icon: "code" }]
      : []),
  ];
  return (
    <div className={styles.sheetBody}>
      {screen !== "behaviour" && (
        <button
          type="button"
          className={styles.backLink}
          onClick={() => {
            setScreen("behaviour");
            setChoice(null);
          }}
        >
          <Icon name="back" size={14} /> Back
        </button>
      )}
      <h2>{title}</h2>
      {screen === "timing" ? (
        <ComponentTiming component={component} />
      ) : screen === "more" ? (
        <MoreOptions component={component} onCode={onCode} />
      ) : screen === "save" ? (
        <>
          <FormReplyCollection component={component} fields={fields} />
          <button type="button" className={styles.row} onClick={onCode}>
            A URL <span>Edit in Code</span>
          </button>
        </>
      ) : (
        <>
          {control !== null && (
            <>
              {request && !replacing ? (
                <div className={styles.notice}>
                  <strong>Custom request action</strong>
                  <p>Edit this in Code, or choose a simple replacement.</p>
                  <button type="button" onClick={onCode}>
                    Edit in Code
                  </button>
                  <button type="button" onClick={() => setReplacing(true)}>
                    Replace with simple action…
                  </button>
                </div>
              ) : (
                <>
                  {request && (
                    <p className={styles.hint}>
                      Choosing a behavior replaces this custom action.{" "}
                      <button type="button" onClick={() => setReplacing(false)}>
                        Keep custom action
                      </button>
                    </p>
                  )}
                  <p className={styles.hint}>
                    Pick what should happen. Settings appear for your choice.
                  </p>
                  <div className={styles.catalogue}>
                    {behaviours.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={
                          (screen === "after" ? outcome?.kind : selected) ===
                          item.id
                        }
                        onClick={() => choose(item.id)}
                      >
                        <span
                          className={styles.behaviourDisc}
                          data-accent={item.id === "collect"}
                        >
                          <Icon name={item.icon} size={24} />
                        </span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                  {selected === "collect" && screen !== "after" && (
                    <div className={styles.stack}>
                      <button
                        type="button"
                        className={styles.row}
                        onClick={() => setScreen("save")}
                      >
                        Save answers to{" "}
                        <span>
                          {collecting ? "Your inbox" : "Set up your inbox"}
                          <Icon name="arrow" size={14} />
                        </span>
                      </button>
                      {collecting && (
                        <button
                          type="button"
                          className={styles.row}
                          onClick={() => setScreen("after")}
                        >
                          After saving{" "}
                          <span>
                            {outcome?.kind === "scene"
                              ? "Go to a scene"
                              : outcome?.kind === "time"
                                ? "Jump to a point"
                                : "Continue video"}
                            <Icon name="arrow" size={14} />
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                  {(selected === "time" ||
                    (screen === "after" && outcome?.kind === "time")) &&
                    scene && (
                      <div
                        className={styles.stack}
                        onPointerDownCapture={() => {
                          edited.current = false;
                        }}
                        onKeyDownCapture={() => {
                          edited.current = false;
                        }}
                      >
                        <p className={styles.hint}>
                          {pickTime(outcome?.kind === "time" ? outcome.t : 0)}{" "}
                          of {pickTime(sceneDuration(scene))}
                        </p>
                        <FrameFilmstrip
                          scene={scene}
                          time={outcome?.kind === "time" ? outcome.t : 0}
                          maximum={sceneDuration(scene)}
                          label="Jump to a point in this scene"
                          onTime={(t) => {
                            apply({ kind: "time", t }, !edited.current);
                            edited.current = true;
                          }}
                        />
                      </div>
                    )}
                  {(selected === "scene" ||
                    (screen === "after" && outcome?.kind === "scene")) && (
                    <div className={styles.stack}>
                      {scenes
                        .filter((item) => item.id !== component.sceneId)
                        .map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={styles.row}
                            aria-pressed={
                              outcome?.kind === "scene" &&
                              outcome.sceneId === item.id
                            }
                            onClick={() =>
                              apply({ kind: "scene", sceneId: item.id })
                            }
                          >
                            {item.name}
                            <span>
                              {sceneDuration(item)
                                ? pickTime(sceneDuration(item))
                                : "No content yet"}
                            </span>
                          </button>
                        ))}
                      <button
                        type="button"
                        className={styles.row}
                        onClick={() =>
                          setError(
                            createRoutedScene(
                              component.id,
                              target,
                              screen === "after" ? "success" : undefined,
                            ) === null,
                          )
                        }
                      >
                        <Icon name="plus" size={16} /> New scene
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <div className={styles.stack}>
            <button
              type="button"
              className={styles.row}
              onClick={() => setScreen("timing")}
            >
              Appears
              <span>
                {pickTime(component.at)} ·{" "}
                {component.dur === null
                  ? "until clip ends"
                  : `for ${component.dur} s`}
                <Icon name="arrow" size={14} />
              </span>
            </button>
            {component.type !== "tooltip" && (
              <button
                type="button"
                className={styles.row}
                onClick={() => setScreen("more")}
              >
                More options
                <Icon name="arrow" size={14} />
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <p className={styles.error} role="alert">
          Fix this action’s Logic in Code first.
        </p>
      )}
    </div>
  );
}
