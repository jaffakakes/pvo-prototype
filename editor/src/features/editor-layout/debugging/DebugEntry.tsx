import { useMemo } from "react";
import { errorCount, groupInteractions } from "../../../domain/debugging/selectors";
import { useTryDebugStore } from "../../../state/debugging/tryDebugStore";
import { DebugButton } from "../../try-debugger/DebugButton";
import { setDebugOpen, useDebugUi } from "../../try-debugger/uiStore";

export function DebugEntry({ variant }: { variant: "desktop" | "mobile" | "lastRun" }) {
  const run = useTryDebugStore(state => state.run);
  const open = useDebugUi(state => state.open);
  const errors = useMemo(() => errorCount(groupInteractions(run)), [run]);
  if (!run || variant === "lastRun" && run.status === "running") return null;
  return <DebugButton variant={variant} open={open} onClick={() => setDebugOpen(!open)}
    errorCount={errors} hasLastRun={run.status !== "running"} />;
}
