let nextId = 1;
export const uid = () => nextId++;

/** Prevent restored project IDs from colliding with IDs created in this session. */
export function advanceUidPast(id: number): void {
  if (Number.isSafeInteger(id) && id >= nextId)
    nextId = id + 1;
}
