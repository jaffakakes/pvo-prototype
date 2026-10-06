import {
  parsePreparedTaskResult,
  type PreparedTaskResult,
} from "../../../../packages/pvo-assistant/results/index.js";
import type { ProjectSnapshot } from "../project/model";
import { prepareNativeBatch } from "./native/batch";
import type { NativePreparation } from "./native/types";

/** Caller obtains the result through authenticated, hash-checked transport and guards account/project freshness. */
export function prepareSavedResult(
  project: ProjectSnapshot,
  value: PreparedTaskResult,
  options: Omit<NativePreparation, "attachment"> & {
    origin: string;
    now: number;
  },
) {
  const result = parsePreparedTaskResult(value);
  return prepareNativeBatch(project, result.operations, {
    ...options,
    ...(result.attachment
      ? {
          attachment: {
            ...result.attachment,
            scope: {
              ownerId: result.ownerId,
              projectId: result.projectId,
              taskId: result.taskId,
            },
            origin: options.origin,
            now: options.now,
          },
        }
      : {}),
  });
}
