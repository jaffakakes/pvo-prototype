import { useMemo } from "react";
import { groupInteractions } from "../../../domain/debugging/selectors";
import { useTryDebugStore } from "../../../state/debugging/tryDebugStore";
import styles from "./DebugWorkspace.module.css";

/** A quiet marker; normal timeline selection and dragging remain unchanged. */
export function DebugLayerIssue({ componentId }: { componentId: string }) {
  const run = useTryDebugStore(state => state.run);
  const issue = useMemo(() => groupInteractions(run).find(group => group.componentId === componentId
    && ["failed", "unavailable", "no_action", "blocked"].includes(group.result)), [run?.records, componentId]);
  if (!issue) return null;
  return <i className={styles.layerIssue} title={`${issue.resultLabel} in last Try · open Debug for details`}
    aria-label={`${issue.resultLabel} in last Try`} data-debug-layer-issue>!</i>;
}
