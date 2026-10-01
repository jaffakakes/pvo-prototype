import { useEffect } from "react";
import { useTryDebugStore } from "../../../state/debugging/tryDebugStore";
import { markDebugRunStopped, resetDebugUiForRun, setDebugOpen, useDebugUi } from "../../try-debugger/uiStore";
import { clearDebugLocate } from "./debugLocate";

/** Kept above the desktop/mobile switch so rotation preserves inspection state. */
export function useDebugLifecycle() {
  const runId = useTryDebugStore(state => state.run?.id);
  const status = useTryDebugStore(state => state.run?.status);
  useEffect(() => {
    clearDebugLocate();
    if (runId) resetDebugUiForRun(runId);
    else {
      setDebugOpen(false);
      useDebugUi.setState({ runId: null });
    }
  }, [runId]);
  useEffect(() => { if (status && status !== "running") markDebugRunStopped(); }, [status]);
  useEffect(() => clearDebugLocate, []);
}
