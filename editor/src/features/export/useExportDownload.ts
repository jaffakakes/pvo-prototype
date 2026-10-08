import { useEffect, useRef, useState } from "react";
import type { CompletedExport } from "../../domain/publishing/model";
import { requireAccount } from "../../state/auth/authGateStore";
import { prepareExportDelivery } from "./prepareExportDelivery";
import { downloadCompletedExport } from "./exportWorkflow";

/** Both result screens use this command, including a fresh service check on repeated downloads. */
export function useExportDownload() {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);
  const download = async (artifact: CompletedExport, url: string) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setFailure(null);
    try {
      if (!(await requireAccount("download")) || !mounted.current) return;
      await prepareExportDelivery(artifact, controller.signal);
      controller.signal.throwIfAborted();
      downloadCompletedExport(url, artifact.filename);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted)
        setFailure(
          error instanceof Error
            ? error.message
            : "Couldn't prepare this download. Try again.",
        );
    } finally {
      if (active.current === controller) active.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  return { download, failure, busy };
}
