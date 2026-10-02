import type { PvoComponent } from "../project/model";

type Change = { path: string[]; before: unknown; after: unknown };

export type AssistantThreadPatch = {
  sceneId: string;
  componentId: string;
  changes: Change[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .every(key => equal(left[key], right[key]));
}

function changesAt(before: unknown, after: unknown, path: string[], changes: Change[]) {
  if (equal(before, after)) return;
  if (isRecord(before) && isRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      changesAt(before[key], after[key], [...path, key], changes);
    }
    return;
  }
  // Arrays and newly created objects are atomic: indexes must never follow a
  // reordered control, and removing a created object must not erase later work.
  changes.push({ path, before: structuredClone(before), after: structuredClone(after) });
}

export function createAssistantThreadPatch(before: PvoComponent, after: PvoComponent): AssistantThreadPatch {
  const changes: Change[] = [];
  for (const key of ["fields", "look", "code"] as const) {
    changesAt(before[key], after[key], [key], changes);
  }
  return { sceneId: before.sceneId, componentId: before.id, changes };
}

function valueAt(value: unknown, path: readonly string[]): unknown {
  for (const key of path) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return value;
}

export function assistantPatchMatches(
  component: PvoComponent | undefined,
  patch: AssistantThreadPatch,
  side: "before" | "after",
): boolean {
  return !!component && component.id === patch.componentId && component.sceneId === patch.sceneId
    && patch.changes.length > 0
    && patch.changes.every(change => equal(valueAt(component, change.path), change[side]));
}

/** A targeted history operation either applies every owned value or none. */
export function applyAssistantThreadPatch(
  component: PvoComponent,
  patch: AssistantThreadPatch,
  direction: "undo" | "redo",
): PvoComponent | null {
  const from = direction === "undo" ? "after" : "before";
  const to = direction === "undo" ? "before" : "after";
  if (!assistantPatchMatches(component, patch, from)) return null;
  const next = structuredClone(component);
  for (const change of patch.changes) {
    let parent: unknown = next;
    for (const key of change.path.slice(0, -1)) {
      if (!isRecord(parent)) return null;
      parent = parent[key];
    }
    if (!isRecord(parent)) return null;
    const key = change.path[change.path.length - 1];
    if (change[to] === undefined) delete parent[key];
    else parent[key] = structuredClone(change[to]);
  }
  return next;
}
