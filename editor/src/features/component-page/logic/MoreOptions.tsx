import { useState } from "react";
import { fieldsShownFor } from "../../../domain/components/fields";
import { editComponentWaitingLabel } from "../../../domain/components/languageActionEditing";
import {
  responsePolicyFor,
  acceptsResponse,
} from "../../../domain/components/responsePolicy";
import type {
  PvoComponent,
  ResponsePolicy,
} from "../../../domain/project/model";
import { useCapture } from "../../../state/captureStore";
import { FieldInput } from "../../component-authoring/fields/FieldInput";
import { ActionRow } from "../../component-authoring/outcomes/ActionRow";
import styles from "../ComponentPage.module.css";

export function MoreOptions({
  component,
  onCode,
}: {
  component: PvoComponent;
  onCode(): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const fields = fieldsShownFor(component);
  const policy = responsePolicyFor(component);
  const updatePolicy = (patch: Partial<ResponsePolicy>) =>
    useCapture.getState().updateComponent(component.id, {
      responsePolicy: { ...policy, ...patch },
    });
  const collecting = fields.formSubmitMode === "collect";
  return (
    <div className={styles.stack}>
      {component.type === "form" && (
        <>
          <h3>Sending</h3>
          <FieldInput
            label="Sending text"
            value={fields.waitingLabel || ""}
            maxLength={40}
            onChange={(label, undoable) => {
              const state = useCapture.getState();
              const current = state.components.find(
                (item) => item.id === component.id,
              );
              const changes =
                current && editComponentWaitingLabel(current, label);
              if (changes) {
                state.updateComponent(component.id, changes, undoable);
                setError(null);
              } else
                setError(
                  "Fix the submit tag in Code before changing its sending text.",
                );
            }}
          />
          {collecting && (
            <>
              <button
                type="button"
                className={styles.row}
                aria-pressed={!fields.failureOutcome}
                onClick={() =>
                  useCapture.getState().updateComponent(component.id, {
                    fields: { ...fields, failureOutcome: null },
                  })
                }
              >
                If sending fails <span>Keep the form open</span>
              </button>
              <ActionRow
                component={component}
                label="Or go somewhere else"
                outcome={fields.failureOutcome}
                target={{ kind: "form" }}
                branch="error"
                onChange={(value) => {
                  useCapture.getState().updateComponent(component.id, {
                    fields: { ...fields, failureOutcome: value },
                  });
                }}
              />
            </>
          )}
          {!collecting && fields.outcome?.kind === "request" && (
            <button type="button" className={styles.row} onClick={onCode}>
              If sending fails <span>Edit in Code</span>
            </button>
          )}
        </>
      )}
      {component.type !== "tooltip" && (
        <>
          <h3>Waiting</h3>
          <p className={styles.hint}>If nobody responds</p>
          <div className={styles.parts}>
            <button
              type="button"
              aria-pressed={policy.unanswered === "continue"}
              onClick={() => updatePolicy({ unanswered: "continue" })}
            >
              Keep playing
            </button>
            <button
              type="button"
              disabled={!acceptsResponse(component)}
              aria-pressed={policy.unanswered === "pause"}
              onClick={() => updatePolicy({ unanswered: "pause" })}
            >
              Pause and wait
            </button>
          </div>
          <p className={styles.hint}>When someone responds</p>
          <div className={styles.parts}>
            <button
              type="button"
              aria-pressed={policy.dispatch === "interaction"}
              onClick={() => updatePolicy({ dispatch: "interaction" })}
            >
              Act right away
            </button>
            <button
              type="button"
              aria-pressed={policy.dispatch === "layer_end"}
              onClick={() => updatePolicy({ dispatch: "layer_end" })}
            >
              Act when the layer ends
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <h3>Advanced</h3>
      <button type="button" className={styles.row} onClick={onCode}>
        Custom logic <span>{component.type}.logic</span>
      </button>
    </div>
  );
}
