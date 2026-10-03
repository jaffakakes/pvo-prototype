import { useEffect, useRef, useState } from "react";
import type { CompletedExport, PublishingStatus } from "../../domain/publishing/model";
import { publicationInput } from "../../domain/publishing/exportSnapshot";
import { createPublishingClient, PublishingHttpError } from "../../infrastructure/publishing/client";
import { cancelledShare } from "../../infrastructure/publishing/nativeShare";
import { beginPublicationAttempt, expirePublicationAttempt, setExportPublication, useExportArtifact } from "../../state/export/exportArtifactStore";

type Stage = "idle" | "checking" | "preparing" | "reserving" | "uploading";

export function usePublication(artifact: CompletedExport) {
  const [client] = useState(() => createPublishingClient());
  const [status, setStatus] = useState<PublishingStatus | null>(null);
  const [stage, setStage] = useState<Stage>("checking");
  const [failure, setFailure] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const publication = useExportArtifact(state => state.publication);
  const title = useExportArtifact(state => state.publicationTitle);

  const refreshStatus = async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setStage("checking"); setFailure(null);
    try {
      const result = await client.status(controller.signal);
      if (!controller.signal.aborted && mounted.current) setStatus(result);
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setFailure("Couldn't check link sharing. Try again.");
    } finally {
      if (active.current === controller) { active.current = null; if (mounted.current) setStage("idle"); }
    }
  };
  useEffect(() => {
    mounted.current = true;
    void refreshStatus();
    return () => { mounted.current = false; active.current?.abort(); };
  }, [artifact.snapshotId]);

  const createLink = async (requestedTitle: string) => {
    if (active.current || !status || !status.available || publication?.status === "ready") return;
    const controller = new AbortController();
    active.current = controller;
    setFailure(null);
    let attemptedKey: string | null = null;
    try {
      setStage("preparing");
      // Refresh on each explicit attempt, including when the displayed session has expired.
      const session = await client.session(controller.signal);
      controller.signal.throwIfAborted();
      if (mounted.current) setStatus(session);
      const saved = useExportArtifact.getState();
      const input = publicationInput(artifact, saved.publicationTitle ?? requestedTitle, session, saved.publicationKey);
      attemptedKey = input.idempotencyKey;
      beginPublicationAttempt(artifact.snapshotId, input.title);
      setStage("reserving");
      let reserved = await client.reserve(input, controller.signal);
      controller.signal.throwIfAborted();
      setExportPublication(artifact.snapshotId, reserved, input.idempotencyKey);
      if (reserved.status !== "ready") {
        setStage("uploading");
        reserved = await client.upload(reserved.id, artifact, controller.signal);
        controller.signal.throwIfAborted();
        if (reserved.status !== "ready") throw new Error("The upload isn't ready. Try again.");
        setExportPublication(artifact.snapshotId, reserved, input.idempotencyKey);
      }
    } catch (error) {
      if (!controller.signal.aborted && !cancelledShare(error) && mounted.current) {
        // A session lost during upload is renewed on the next explicit attempt.
        if (error instanceof PublishingHttpError && error.status === 401)
          setStatus(current => current && { ...current, hasSession: false });
        if (error instanceof PublishingHttpError && error.status === 410 && attemptedKey !== null)
          expirePublicationAttempt(artifact.snapshotId, attemptedKey, crypto.randomUUID());
        setFailure(error instanceof Error ? error.message : "Link sharing failed. Try again.");
      }
    } finally {
      if (active.current === controller) { active.current = null; if (mounted.current) setStage("idle"); }
    }
  };
  return { client, status, stage, publication, title, failure, refreshStatus, createLink,
    cancel: () => { active.current?.abort(); }, clearFailure: () => setFailure(null) };
}
