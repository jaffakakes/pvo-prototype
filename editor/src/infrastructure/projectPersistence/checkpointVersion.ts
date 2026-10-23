/** Compare persisted data itself, without changing the checkpoint format. */
export type CheckpointVersion = string | null;

export function checkpointVersion(record: unknown): CheckpointVersion {
  return record === undefined ? null : JSON.stringify(record);
}

export class ProjectSaveConflict extends Error {
  constructor() {
    super(
      "Another tab changed this project. Your changes are still here; save a copy to keep them.",
    );
    this.name = "ProjectSaveConflict";
  }
}

export function assertCheckpointVersion(
  record: unknown,
  expected: CheckpointVersion,
): void {
  if (checkpointVersion(record) !== expected) throw new ProjectSaveConflict();
}
