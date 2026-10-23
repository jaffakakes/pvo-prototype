import type { ProjectSnapshot } from "./model";

export const HISTORY_LIMIT = 40;
type HistoryOwner = {
  localId: string | null;
  past: readonly ProjectSnapshot[];
  future: readonly ProjectSnapshot[];
};

export function ownsHistory(
  current: HistoryOwner,
  before: HistoryOwner,
): boolean {
  return (
    current.localId === before.localId &&
    current.past === before.past &&
    current.future === before.future
  );
}

export function appendHistory(
  past: readonly ProjectSnapshot[],
  snapshot: ProjectSnapshot,
): ProjectSnapshot[] {
  return [...past, snapshot].slice(-HISTORY_LIMIT);
}

export function committedHistory(
  past: readonly ProjectSnapshot[],
  snapshot: ProjectSnapshot,
) {
  return {
    past: appendHistory(past, snapshot),
    future: [] as ProjectSnapshot[],
  };
}
