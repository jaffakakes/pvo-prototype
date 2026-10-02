import type { NativeEntityReference, NativeEntityState, NativeExecutionContext, NativeOperation, NativePreparationReceipt } from "../../../../../packages/pvo-assistant/native/index.js";
import type { ProjectSnapshot } from "../../project/model";
import { nativeProjectContext, nativeProjectFingerprint, nativeValueFingerprint } from "./context";

export function nativeEntityReference(state: NativeEntityState): NativeEntityReference {
  if (state.kind === "project") return { kind: "project" };
  if (state.kind === "scene") return { kind: "scene", sceneId: state.sceneId };
  if (state.kind === "component") return { kind: state.kind, sceneId: state.sceneId, id: state.values.id };
  return { kind: state.kind, sceneId: state.sceneId, id: state.values.id };
}
const entityKey = (entity: NativeEntityReference): string => JSON.stringify(entity);

/** Reuse the public context projection, excluding source blobs and all private media data. */
export function nativeReceiptValues(project: ProjectSnapshot): Map<string, NativeEntityState> {
  const context = nativeProjectContext(project, 0);
  const states: NativeEntityState[] = [{ kind: "project", values: { ratio: context.ratio, canvas: context.canvas } }];
  for (const scene of context.scenes) {
    const { clips, texts, audioClips, components, ...values } = scene;
    states.push({ kind: "scene", sceneId: scene.id, values });
    for (const values of clips) states.push({ kind: "clip", sceneId: scene.id, values });
    for (const values of texts) states.push({ kind: "text", sceneId: scene.id, values });
    for (const values of audioClips) states.push({ kind: "audio", sceneId: scene.id, values });
    for (const { source, design, ...values } of components) states.push({ kind: "component", sceneId: scene.id,
      values: { ...values, sourceFingerprint: nativeValueFingerprint({ source, design }) } });
  }
  return new Map(states.map(state => [entityKey(nativeEntityReference(state)), state]));
}

function operationTarget(operation: NativeOperation): NativeEntityReference | null {
  if (operation.kind === "project.ratio") return { kind: "project" };
  if ("target" in operation) {
    if (operation.target.kind === "music") return { kind: "scene", sceneId: operation.sceneId };
    if (operation.target.kind === "component") return { kind: "component", sceneId: operation.sceneId, id: operation.target.id };
    return { kind: operation.target.kind, sceneId: operation.sceneId, id: operation.target.id };
  }
  if ("clipId" in operation) return { kind: "clip", sceneId: operation.sceneId, id: operation.clipId };
  if ("audioId" in operation) return { kind: "audio", sceneId: operation.sceneId, id: operation.audioId };
  if ("textId" in operation) return { kind: "text", sceneId: operation.sceneId, id: operation.textId };
  if ("componentId" in operation) return { kind: "component", sceneId: operation.sceneId, id: operation.componentId };
  if ("sceneId" in operation) return { kind: "scene", sceneId: operation.sceneId };
  if (operation.kind === "scene.add") return { kind: "scene", sceneId: operation.parentId };
  return null;
}

/** Record actual execution order, including generated identities and collateral timeline changes. */
export function nativePreparationReceipt(operation: NativeOperation,
  before: Map<string, NativeEntityState>, after: Map<string, NativeEntityState>): NativePreparationReceipt {
  const changes: NativePreparationReceipt["changes"] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const previous = before.get(key) ?? null;
    const next = after.get(key) ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(next)) changes.push({ before: previous, after: next });
  }
  const effect = operation.kind === "playback.seek" || operation.kind === "playback.play"
    || operation.kind === "playback.pause" || operation.kind === "export.prepare" ? operation : undefined;
  return { operation: operation.kind, target: operationTarget(operation),
    outcome: effect ? "scheduled" : changes.length ? "prepared" : "unchanged", changes,
    ...(effect ? { effect: { ...effect } } : {}) };
}

/** Keep original values fixed for the whole request, even across several candidate edits. */
export function nativeExecutionContext(original: ProjectSnapshot,
  receipts: readonly NativePreparationReceipt[]): NativeExecutionContext {
  const start = nativeReceiptValues(original);
  const affected = new Map<string, NativeEntityReference>();
  for (const receipt of receipts) {
    if (receipt.target) affected.set(entityKey(receipt.target), receipt.target);
    for (const change of receipt.changes) {
      const entity = nativeEntityReference((change.after ?? change.before)!);
      affected.set(entityKey(entity), entity);
    }
  }
  return { requestStartFingerprint: nativeProjectFingerprint(original),
    requestStartValues: [...affected].map(([key, entity]) => ({ entity, state: start.get(key) ?? null })),
    receipts: [...receipts] };
}
