import { createHash } from "node:crypto";
import { createWorkspaceTools } from "../../../server/assistant/builder/workspaceTools.js";
import { readBuilderWorkspace } from "../../../packages/pvo-assistant/builder/index.js";
import {
  parseServiceFiles,
  serializeServiceFiles,
} from "../../../packages/pvo-assistant/services/index.js";

export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");

/** In-memory benchmark source authority; the driver checkpoints it after each effect. */
export function comparisonWorkspace(sandbox) {
  let snapshot = null,
    started = null;
  const receipts = new Map();
  function receipt(id, kind, result) {
    const value = {
      id,
      kind,
      digest: digest(JSON.stringify({ id, kind, result })),
      status: "completed",
      result,
    };
    receipts.set(id, value);
    return value;
  }
  function exact(reference) {
    if (
      snapshot?.revision !== reference.revision ||
      snapshot?.digest !== reference.digest
    )
      throw new Error("Source changed; read the current revision and digest.");
  }
  const tools = createWorkspaceTools({
    read: async (_id, tool) => readBuilderWorkspace(snapshot, tool),
    receipt: async (_id, operationId) => receipts.get(operationId) ?? null,
    write: async (value) => {
      if (value.expectedRevision !== (snapshot?.revision ?? 0))
        throw new Error(
          "Save expectedRevision does not match the current source.",
        );
      const files = parseServiceFiles(value.files),
        sourceDigest = digest(serializeServiceFiles(files));
      if (sourceDigest === snapshot?.digest)
        throw new Error(
          "Source is unchanged. Continue from the existing successful write.",
        );
      snapshot = {
        revision: value.expectedRevision + 1,
        digest: sourceDigest,
        files,
      };
      started = null;
      return receipt(value.id, "save", {
        revision: snapshot.revision,
        digest: snapshot.digest,
      });
    },
    start: async (value) => {
      exact(value);
      started = snapshot.digest;
      return receipt(value.id, "start", {
        revision: snapshot.revision,
        digest: snapshot.digest,
        deadlineAt: Date.now() + 120000,
      });
    },
    command: async (value) => {
      exact(value);
      if (started !== snapshot.digest)
        throw new Error("Start the exact current source before checking it.");
      if (
        value.command.paths.some(
          (path) => !snapshot.files.some((file) => file.path === path),
        )
      )
        throw new Error("A selected command file is absent.");
      const result = await sandbox.command(
        snapshot.files,
        value.command.kind,
        value.command.paths,
      );
      return receipt(value.id, "command", result);
    },
  });
  return {
    ...tools,
    snapshot: () => structuredClone(snapshot),
    endBatch: () => {
      started = null;
    },
  };
}
