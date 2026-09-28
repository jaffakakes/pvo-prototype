import { useEffect, useRef, useState } from "react";
import { useCapture } from "../state/captureStore";
import { saveProjectBeforeUpdate } from "./projectAutosave";
import { navigateProject } from "./navigation";

/** Back/forward to another saved project must finish saving before hydration. */
export function useProjectNavigation(requestedId: string | null) {
  const activeId = useCapture(state => state.localId);
  const previousId = useRef(activeId);
  const [error, setError] = useState<string | null>(null);
  const switching = !!requestedId && !!activeId && requestedId !== activeId;
  useEffect(() => {
    if (previousId.current && !activeId && requestedId === previousId.current) navigateProject(null, true);
    previousId.current = activeId;
  }, [activeId, requestedId]);
  useEffect(() => {
    if (!switching) { setError(null); return; }
    let cancelled = false;
    void saveProjectBeforeUpdate().then(() => {
      if (!cancelled) location.reload();
    }).catch(error => {
      console.error("Could not save before switching local projects:", error);
      if (!cancelled) setError("Couldn't save this edit. Return to your project and retry browser storage.");
    });
    return () => { cancelled = true; };
  }, [requestedId, switching]);
  return { switching, error };
}
