import { saveProjectBeforeUpdate } from "../../../app/projectAutosave";
import {
  createSavedTask,
  readSavedTask,
  resolveTaskProject,
  SavedTaskHttpError,
} from "../../../infrastructure/assistant/savedTaskTransport";
import {
  assertTaskLinkRequest,
  beginTaskLinkRequest,
  finishSavedTask,
  stageSavedTask,
} from "../../../state/assistant/taskProjectCommands";
import { createSavedTaskWorkflow } from "./creationWorkflow";

export const savedTaskCreation = createSavedTaskWorkflow({
  begin: beginTaskLinkRequest,
  assert: assertTaskLinkRequest,
  stage: stageSavedTask,
  finish: finishSavedTask,
  flush: saveProjectBeforeUpdate,
  resolve: resolveTaskProject,
  create: createSavedTask,
  read: async (reference, signal) => {
    try {
      return await readSavedTask(reference, signal);
    } catch (error) {
      if (
        error instanceof SavedTaskHttpError &&
        [404, 410].includes(error.status)
      )
        return null;
      throw error;
    }
  },
  operationId: () => crypto.randomUUID(),
});
