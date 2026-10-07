import { compilePvoComponent } from "../../../../packages/pvo-language/index.js";
import type {
  ServiceAttachmentReceipt,
  ServiceInputBinding,
} from "../../../../packages/pvo-assistant/attachments/index.js";
import { saveProjectBeforeUpdate } from "../../app/projectAutosave";
import { nativeProjectFingerprint } from "../../domain/assistant/native/context";
import { prepareNativeBatch } from "../../domain/assistant/native/batch";
import { componentLanguageSource } from "../../domain/components/languageCompilation";
import {
  proposeContainerConnection,
  type ConnectionTarget,
} from "../../domain/services/connectionEditing";
import { resolveTaskProject } from "../../infrastructure/assistant/savedTaskTransport";
import { verifyContainerAttachment } from "../../infrastructure/services/attachments";
import { uid } from "../../infrastructure/ids";
import {
  beginTaskLinkRequest,
  linkSavedProject,
  assertTaskLinkRequest,
} from "../../state/assistant/taskProjectCommands";
import { commitNativeBatch } from "../../state/assistant/nativeCommands";
import { useCapture } from "../../state/captureStore";
import { useEditorPreferences } from "../../state/preferences/editorPreferences";
import { projectSnapshot } from "../../state/project/history";

/** Authenticated readiness + actual compiler + one existing guarded history command. No model/workshop. */
export async function connectContainerComponent(
  receipt: ServiceAttachmentReceipt,
  sceneId: string,
  componentId: string,
  target: ConnectionTarget,
  input: ServiceInputBinding,
  signal: AbortSignal,
) {
  let scope = beginTaskLinkRequest();
  const current = () => {
    signal.throwIfAborted();
    assertTaskLinkRequest(scope);
  };
  if (scope.ownerId !== receipt.identity.ownerId)
    throw new Error("The Container belongs to another account.");
  const before = projectSnapshot(useCapture.getState());
  await saveProjectBeforeUpdate();
  current();
  const projectId = await resolveTaskProject(scope.localId, signal);
  current();
  if (projectId !== receipt.identity.projectId)
    throw new Error(
      "Open this Container’s original project before connecting it.",
    );
  scope = linkSavedProject(scope, projectId);
  await saveProjectBeforeUpdate();
  current();
  const component = before.scenes
    .find((scene) => scene.id === sceneId)
    ?.components.find((item) => item.id === componentId);
  if (!component)
    throw new Error("This component is no longer in the project.");
  const compiled = await compilePvoComponent(
    component.type,
    componentLanguageSource(component),
  );
  current();
  const proposed = proposeContainerConnection(
    component,
    sceneId,
    compiled,
    receipt,
    target,
    input,
    window.location.origin,
    Date.now(),
  );
  const attachment = await verifyContainerAttachment(proposed, signal);
  current();
  const batch = await prepareNativeBatch(
    before,
    [attachment.command.component],
    {
      attachment,
      compile: compilePvoComponent,
      createId: uid,
      advancedEditingEnabled:
        useEditorPreferences.getState().advancedEditingEnabled,
      signal,
    },
  );
  current();
  return commitNativeBatch(batch, nativeProjectFingerprint(before), "edit");
}
