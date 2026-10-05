import type { TaskApplication } from "../../../../packages/pvo-assistant/results/index.js";
import type { NativeBatch } from "../../domain/assistant/native/batch";
import { recordTaskApplication } from "../../domain/assistant/taskProjectLink";
import { useCapture } from "../captureStore";
import { nativeBatchCommitValues } from "./nativeCommands";
import {
  assertTaskLinkRequest,
  beginTaskLinkRequest,
  type TaskLinkRequest,
} from "./taskProjectCommands";

/** Project changes and replay protection enter the same store update and checkpoint. */
export function commitSavedTaskResult(
  scope: TaskLinkRequest,
  batch: NativeBatch,
  fingerprint: string,
  receipt: TaskApplication,
): TaskLinkRequest {
  assertTaskLinkRequest(scope);
  if (!scope.links || receipt.ownerId !== scope.ownerId)
    throw new Error("The saved result belongs to a different account.");
  const links = recordTaskApplication(scope.links, receipt);
  if (links === scope.links) return scope;
  const values = nativeBatchCommitValues(batch, fingerprint, "edit");
  const state = useCapture.getState();
  if (values) state.edit({ ...values, assistantTaskLinks: links });
  else state.patch({ assistantTaskLinks: links });
  return beginTaskLinkRequest();
}
