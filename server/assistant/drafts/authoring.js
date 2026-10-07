import { prepareWorkspaceIdentity } from "../workspaces/identity.js";
import {
  parseDraftDecision,
  prepareDraftEdit,
  readDraftFile,
} from "./decisions.js";
import {
  newBuilderState,
  acceptBuilderDecision,
} from "../../../packages/pvo-assistant/builder/index.js";
import { serializeServiceAgreement } from "../../../packages/pvo-assistant/services/index.js";
import { contentDigest } from "../../contentDigest.js";
import { AuthoringRepairError } from "../tasks/repairFeedback.js";

export function draftQuestion(task, prompt, choices) {
  return {
    kind: "ask",
    question: {
      id: `question-${task.archivedQuestions + task.questions.length + 1}`,
      revision: 0,
      prompt,
      choices,
      answer: null,
    },
  };
}

/** Prepare a decision without effects. The inference receipt and working copy commit together. */
export async function prepareDraftResponse(coordinator, task, response) {
  try {
    const decision = parseDraftDecision(response);
    const state = coordinator.drafts.get(task.id);
    let command = { kind: "checkpoint", stepId: "plan" },
      builder = null;
    if (decision.kind === "read")
      state.read = readDraftFile(state, decision.path, decision.offset);
    if (["write", "replace"].includes(decision.kind)) {
      state.pending = prepareDraftEdit(
        state,
        decision,
        `draft-${task.id}-${task.generation}`,
      );
      command.stepId = "draft_apply";
    }
    if (decision.kind === "ask")
      command = draftQuestion(task, decision.prompt, decision.choices);
    if (decision.kind === "done") command.stepId = "draft_finish";
    if (decision.kind === "execute") {
      const { agreement, files } = state.draft.content;
      if (!agreement)
        throw new Error(
          "Save a behavior agreement before requesting development execution.",
        );
      const digest = await contentDigest(serializeServiceAgreement(agreement));
      builder = acceptBuilderDecision(
        newBuilderState(),
        { kind: "agreement", agreement },
        digest,
      );
      builder.round += coordinator.builders.get(task.id).round;
      const previous = coordinator.workspaces.link(task.id)
        ? await coordinator
            .workspaceProvider()
            .lookup(await prepareWorkspaceIdentity(task))
        : null;
      builder = acceptBuilderDecision(
        builder,
        {
          kind: "tools",
          calls: [
            {
              kind: "workspace_write",
              expectedRevision: previous?.source?.revision ?? 0,
              files,
            },
          ],
          review: null,
        },
        null,
      );
      state.reason = decision.reason;
      state.testingRevision = state.draft.revision;
      command.stepId = "build";
    }
    return { draftState: state, command, builder };
  } catch (error) {
    throw new AuthoringRepairError("draft_response", error.message, response);
  }
}
