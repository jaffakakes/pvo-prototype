import type { NativeEntityState, NativePreparationReceipt, NativeScheduledEffect } from "../../../../../packages/pvo-assistant/native/index.js";
import { nativeEntityReference } from "./receipts";

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const key = (state: NativeEntityState): string => JSON.stringify(nativeEntityReference(state));

/** Compare only changed fields: a later independent edit does not undo this result. */
function changedValuesPresent(before: unknown, after: unknown, current: unknown): boolean {
  if (same(before, after)) return true;
  if (!before || !after || typeof before !== "object" || typeof after !== "object"
    || Array.isArray(before) || Array.isArray(after)) return same(after, current);
  if (!current || typeof current !== "object" || Array.isArray(current)) return false;
  const previous = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  const values = current as Record<string, unknown>;
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .every(field => changedValuesPresent(previous[field], next[field], values[field]));
}

function effectFamily(effect: NativeScheduledEffect): string {
  return effect.kind === "playback.play" || effect.kind === "playback.pause" ? "playback.state" : effect.kind;
}
function sameEffect(left: NativeScheduledEffect, right: NativeScheduledEffect): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "playback.seek" && right.kind === "playback.seek")
    return left.sceneId === right.sceneId && left.time === right.time;
  if (left.kind === "export.prepare" && right.kind === "export.prepare") return left.format === right.format;
  return true;
}

/** A previous call is redundant only while its actual result remains in this candidate. */
export function nativePreparedResultPresent(receipt: NativePreparationReceipt,
  current: ReadonlyMap<string, NativeEntityState>, pending: readonly NativePreparationReceipt[]): boolean {
  if (receipt.effect) {
    const family = effectFamily(receipt.effect);
    const latest = [...pending].reverse().find(item => item.effect && effectFamily(item.effect) === family)?.effect;
    return Boolean(latest && sameEffect(receipt.effect, latest));
  }
  const created = receipt.changes.filter(change => change.before === null && change.after !== null);
  // Creation is not a request to reset content. Any surviving generated identity
  // prevents replaying an insertion, even if its fields were deliberately edited.
  if (created.length) return created.some(change => current.has(key(change.after!)));
  if (!receipt.changes.length) return false;
  return receipt.changes.every(({ before, after }) => {
    if (!after) return Boolean(before && !current.has(key(before)));
    const value = current.get(key(after));
    return Boolean(value && changedValuesPresent(before?.values, after.values, value.values));
  });
}
