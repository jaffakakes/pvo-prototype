import { recordPublishedConnections } from "../services/exportConnections";
import { prepareExportDelivery } from "../export/prepareExportDelivery";
import { useEffect, useRef, useState } from "react";
import type {
  CompletedExport,
  PublishingStatus,
} from "../../domain/publishing/model";
import { publicationInput } from "../../domain/publishing/exportSnapshot";
import {
  createPublishingClient,
  PublishingHttpError,
} from "../../infrastructure/publishing/client";
import { cancelledShare } from "../../infrastructure/publishing/nativeShare";
import { requireAccount, useAuthGate } from "../../state/auth/authGateStore";
import {
  beginPublicationAttempt,
  expirePublicationAttempt,
  setExportPublication,
  useExportArtifact,
} from "../../state/export/exportArtifactStore";

type Stage = "idle" | "checking" | "preparing" | "reserving" | "uploading";
type CheckedStatus = { accountId: string | null; value: PublishingStatus };

export function usePublication(artifact: CompletedExport) {
  const [client] = useState(() => createPublishingClient());
  const [checkedStatus, setCheckedStatus] = useState<CheckedStatus | null>(
    null,
  );
  const [stage, setStage] = useState<Stage>("checking");
  const [failure, setFailure] = useState<string | null>(null);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const active = useRef<AbortController | null>(null);
  const activePurpose = useRef<"status" | "publication" | null>(null);
  const mounted = useRef(true);
  const accountId = useAuthGate((state) => state.user?.id ?? null);
  const previousAccountId = useRef(accountId);
  const publication = useExportArtifact((state) => state.publication);
  const title = useExportArtifact((state) => state.publicationTitle);
  const status =
    checkedStatus?.accountId === accountId ? checkedStatus.value : null;
  const visibleStatus =
    status && !accountId ? { ...status, hasSession: false } : status;

  const refreshStatus = async () => {
    active.current?.abort();
    const controller = new AbortController();
    const checkedAccountId = useAuthGate.getState().user?.id ?? null;
    active.current = controller;
    activePurpose.current = "status";
    setStage("checking");
    setFailure(null);
    try {
      const result = await client.status(controller.signal);
      const currentAccountId = useAuthGate.getState().user?.id ?? null;
      if (
        !controller.signal.aborted &&
        mounted.current &&
        currentAccountId === checkedAccountId
      )
        setCheckedStatus({ accountId: checkedAccountId, value: result });
    } catch {
      if (!controller.signal.aborted && mounted.current)
        setFailure("Couldn't check link sharing. Try again.");
    } finally {
      if (active.current === controller) {
        active.current = null;
        activePurpose.current = null;
        if (mounted.current) setStage("idle");
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    void refreshStatus();
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, [artifact.snapshotId]);

  useEffect(() => {
    const previous = previousAccountId.current;
    if (previous === accountId) return;
    previousAccountId.current = accountId;
    const publishing = activePurpose.current === "publication";
    if (previous !== null) active.current?.abort();
    setCheckedStatus(null);
    setFailure(null);
    if (accountId && (previous !== null || !publishing)) void refreshStatus();
  }, [accountId]);

  const createLink = async (requestedTitle: string) => {
    if (
      activePurpose.current ||
      !visibleStatus?.available ||
      publication?.status === "ready"
    )
      return;
    activePurpose.current = "publication";
    setStage("preparing");
    if (!(await requireAccount("share"))) {
      activePurpose.current = null;
      if (mounted.current) setStage("idle");
      return;
    }
    const publishingAccountId = useAuthGate.getState().user?.id;
    if (!publishingAccountId || !mounted.current) {
      activePurpose.current = null;
      if (mounted.current) setStage("idle");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setFailure(null);
    setUploadedBytes(0);
    let attemptedKey: string | null = null;
    const checkAccount = () => {
      controller.signal.throwIfAborted();
      if (useAuthGate.getState().user?.id !== publishingAccountId)
        throw new DOMException("Account changed", "AbortError");
    };
    try {
      // Recheck the account session before each attempt, including after sign-in.
      const session = await client.status(controller.signal);
      checkAccount();
      if (mounted.current)
        setCheckedStatus({ accountId: publishingAccountId, value: session });
      const saved = useExportArtifact.getState();
      const input = publicationInput(
        artifact,
        saved.publicationTitle ?? requestedTitle,
        session,
        saved.publicationKey,
      );
      attemptedKey = input.idempotencyKey;
      beginPublicationAttempt(artifact.snapshotId, input.title);
      await prepareExportDelivery(artifact, controller.signal);
      checkAccount();
      setStage("reserving");
      let reserved = await client.reserve(input, controller.signal);
      checkAccount();
      if (reserved.status !== "ready")
        setExportPublication(
          artifact.snapshotId,
          reserved,
          input.idempotencyKey,
        );
      if (reserved.status !== "ready") {
        setStage("uploading");
        reserved = await client.upload(
          reserved.id,
          artifact,
          controller.signal,
          (bytes) => {
            if (mounted.current) setUploadedBytes(bytes);
          },
        );
        checkAccount();
        if (reserved.status !== "ready")
          throw new Error("The upload isn't ready. Try again.");
      }
      if (artifact.poster) {
        setStage("uploading");
        await client.uploadPoster(
          reserved.id,
          artifact.poster,
          controller.signal,
        );
        checkAccount();
      }
      checkAccount();
      await recordPublishedConnections(
        artifact,
        reserved.id,
        controller.signal,
        checkAccount,
      );
      checkAccount();
      setExportPublication(artifact.snapshotId, reserved, input.idempotencyKey);
    } catch (error) {
      if (
        !controller.signal.aborted &&
        !cancelledShare(error) &&
        mounted.current
      ) {
        // A session lost during upload is renewed on the next explicit attempt.
        if (error instanceof PublishingHttpError && error.status === 401)
          setCheckedStatus((current) =>
            current && current.accountId === publishingAccountId
              ? { ...current, value: { ...current.value, hasSession: false } }
              : current,
          );
        if (
          error instanceof PublishingHttpError &&
          error.status === 410 &&
          attemptedKey !== null
        )
          expirePublicationAttempt(
            artifact.snapshotId,
            attemptedKey,
            crypto.randomUUID(),
          );
        setFailure(
          error instanceof Error
            ? error.message
            : "Link sharing failed. Try again.",
        );
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        activePurpose.current = null;
        if (mounted.current) setStage("idle");
      }
    }
  };
  return {
    client,
    status: visibleStatus,
    stage,
    uploadedBytes,
    publication,
    title,
    failure,
    refreshStatus,
    createLink,
    cancel: () => {
      active.current?.abort();
    },
    clearFailure: () => setFailure(null),
  };
}
