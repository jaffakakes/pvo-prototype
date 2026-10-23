import { compilePvoComponent } from "../../../../../packages/pvo-language/index.js";
import {
  persistedProjectSnapshot,
  saveProjectBeforeUpdate,
} from "../../../app/projectAutosave";
import { nativeProjectFingerprint } from "../../../domain/assistant/native/context";
import { prepareSavedResult } from "../../../domain/assistant/savedResultPreparation";
import { readSavedTask } from "../../../infrastructure/assistant/savedTaskTransport";
import { readSavedResult } from "../../../infrastructure/assistant/savedResultTransport";
import { uid } from "../../../infrastructure/ids";
import {
  assertTaskLinkRequest,
  beginTaskLinkRequest,
} from "../../../state/assistant/taskProjectCommands";
import { commitSavedTaskResult } from "../../../state/assistant/taskResultCommands";
import { useCapture } from "../../../state/captureStore";
import { useEditorPreferences } from "../../../state/preferences/editorPreferences";
import { projectSnapshot } from "../../../state/project/history";
import { createTaskApplicationWorkflow } from "./applicationWorkflow";

export const applySavedTaskResult = createTaskApplicationWorkflow({
  begin: beginTaskLinkRequest,
  assert: assertTaskLinkRequest,
  flush: saveProjectBeforeUpdate,
  project: () => projectSnapshot(useCapture.getState()),
  fingerprint: (project) =>
    nativeProjectFingerprint(persistedProjectSnapshot(project)),
  read: readSavedTask,
  result: readSavedResult,
  prepare: (project, result, signal) =>
    prepareSavedResult(project, result, {
      origin: window.location.origin,
      now: Date.now(),
      signal,
      compile: compilePvoComponent,
      createId: uid,
      advancedEditingEnabled:
        useEditorPreferences.getState().advancedEditingEnabled,
    }),
  commit: commitSavedTaskResult,
});
