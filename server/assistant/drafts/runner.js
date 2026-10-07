import {
  parseServiceDraft,
  parseServiceDraftContent,
} from "../../../packages/pvo-assistant/services/index.js";
import { draftHost, consumeDraftRpc } from "./creation.js";
import { draftQuestion } from "./authoring.js";
import {
  hasCurrentClaim,
  taskClaim,
  transitionGuard,
} from "../tasks/executionClaim.js";
import { withAssistantDeadline } from "../deadline.js";

const target = (task) => task.input.context.container.serviceId;
const current = (coordinator, task) =>
  hasCurrentClaim(coordinator.attempts.task(task.id), task, coordinator.now());
function update(coordinator, claimed, command, save = null) {
  if (!current(coordinator, claimed)) return;
  const task = coordinator.attempts.task(claimed.id);
  const next = coordinator.repository.update(
    task.id,
    command,
    transitionGuard(task, coordinator.now(), taskClaim(task)),
  );
  save?.(next);
}
async function read(coordinator, task) {
  const result = await consumeDraftRpc(
    draftHost(coordinator, target(task)).readDraft(target(task), task.ownerId),
  );
  if (!result.ok) throw new Error("The saved draft is unavailable.");
  return parseServiceDraft(result.value);
}
async function conflict(coordinator, claimed) {
  const latest = await read(coordinator, claimed);
  await coordinator.transaction(() => {
    update(
      coordinator,
      claimed,
      draftQuestion(
        claimed,
        "The saved draft changed while I was editing. I kept the newer code. Continue from that version?",
        ["Continue from the newer saved draft", "Stop editing"],
      ),
      () => {
        const state = coordinator.drafts.get(claimed.id);
        state.draft = latest;
        state.read = null;
        state.pending = null;
        state.conflict = true;
        coordinator.drafts.write(claimed.id, state);
      },
    );
  });
}

/** Non-model steps reuse the task lease; exact save intents survive uncertain RPC replies. */
export async function runDraftStep(coordinator, claimed) {
  const controller = new AbortController();
  coordinator.active.set(claimed.id, controller);
  try {
    await withAssistantDeadline(
      async (signal) => {
        let state = coordinator.drafts.get(claimed.id);
        if (state.conflict) {
          await coordinator.transaction(() =>
            update(
              coordinator,
              claimed,
              { kind: "checkpoint", stepId: "plan" },
              () => {
                state.conflict = false;
                coordinator.drafts.write(claimed.id, state);
              },
            ),
          );
          return;
        }
        if (claimed.stepId === "draft_sync" && !state.pending) {
          const builder = coordinator.builders.get(claimed.id);
          const checked = coordinator.artifacts.verified(
            claimed.id,
            builder.round,
          );
          if (!checked) throw new Error("Independent checks are required.");
          const artifact = checked.artifact;
          await coordinator.transaction(() => {
            if (!current(coordinator, claimed)) return;
            state.pending = {
              actionId: `draft-${claimed.id}-checked-${builder.round}`,
              expectedRevision: state.draft.revision,
              content: parseServiceDraftContent({
                ...state.draft.content,
                agreement: artifact.agreement,
                files: artifact.package.files,
                entrypoint: artifact.package.entrypoint,
                tests: artifact.package.tests,
                dependencies: artifact.package.dependencies,
              }),
            };
            coordinator.drafts.write(claimed.id, state);
          });
        }
        signal.throwIfAborted();
        if (!current(coordinator, claimed)) return;
        if (["draft_apply", "draft_sync"].includes(claimed.stepId)) {
          if (!state.pending) {
            // Answering a conflict resumes this same step; return to planning on the new snapshot.
            await coordinator.transaction(() =>
              update(coordinator, claimed, {
                kind: "checkpoint",
                stepId: "plan",
              }),
            );
            return;
          }
          const result = await consumeDraftRpc(
            draftHost(coordinator, target(claimed)).saveTaskDraft(
              target(claimed),
              claimed.ownerId,
              state.pending,
              {
                taskId: claimed.id,
                generation: claimed.generation,
                expiresAt: claimed.claim.expiresAt,
              },
            ),
          );
          signal.throwIfAborted();
          if (!result.ok) {
            if (result.status === 409) return conflict(coordinator, claimed);
            throw new Error("Draft save could not be confirmed.");
          }
          const draft = parseServiceDraft(result.value.draft);
          if (
            result.value.receipt?.actionId !== state.pending.actionId ||
            result.value.receipt?.revision !==
              state.pending.expectedRevision + 1
          )
            throw new Error(
              "The save receipt does not match the pending edit.",
            );
          if (draft.revision !== result.value.receipt.revision)
            return conflict(coordinator, claimed);
          await coordinator.transaction(() =>
            update(
              coordinator,
              claimed,
              {
                kind: "checkpoint",
                stepId: claimed.stepId === "draft_sync" ? "host" : "plan",
              },
              () => {
                state.draft = draft;
                state.pending = null;
                state.read = null;
                coordinator.drafts.write(claimed.id, state);
              },
            ),
          );
          return;
        }
        const latest = await read(coordinator, claimed);
        signal.throwIfAborted();
        if (latest.revision !== state.draft.revision)
          return conflict(coordinator, claimed);
        const encoded = await coordinator.results.encodeDraft(claimed, latest);
        await coordinator.transaction(() =>
          update(
            coordinator,
            claimed,
            {
              kind: "complete",
              result: {
                artifact: encoded.artifact,
                baseFingerprint: claimed.input.context.fingerprint,
              },
            },
            (next) => coordinator.results.save(next, encoded),
          ),
        );
      },
      coordinator.stepTimeoutMs(),
      controller.signal,
    );
  } catch {
    await coordinator.transaction(() =>
      update(coordinator, claimed, {
        kind: "fail",
        failure: { code: "execution_failed", stepId: claimed.stepId },
      }),
    );
  } finally {
    if (coordinator.active.get(claimed.id) === controller)
      coordinator.active.delete(claimed.id);
  }
}
