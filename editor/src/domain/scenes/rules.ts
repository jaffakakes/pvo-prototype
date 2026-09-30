import type { PvoComponent, Scene } from "../project/model";

export const mainScene = (): Scene => ({
  id: "main", name: "Main", parent: null,
  clips: [], texts: [], components: [], muted: false, sound: 0,
});
export const anyClips = (scenes: readonly Scene[]) => scenes.some(scene => scene.clips.length > 0);
export const componentCount = (scenes: readonly Scene[]) => scenes.reduce((n, scene) => n + scene.components.length, 0);
export const sceneChildren = (scenes: readonly Scene[], id: string): Scene[] =>
  scenes.filter(scene => scene.id !== "main" && (scene.parent ?? "main") === id);

/** Components keep their identity unless they carry a stale scene reference. */
function normalizeComponents(scene: Scene): PvoComponent[] {
  const normalized = scene.components.map(component =>
    component.sceneId === scene.id ? component : { ...component, sceneId: scene.id });
  return normalized.every((component, index) => component === scene.components[index]) ? scene.components : normalized;
}

/** Upgrade flat projects and repair invalid ancestry at project boundaries. */
export function normalizeSceneTree(scenes: readonly Scene[]): Scene[] {
  const unique = new Map(scenes.map(scene => [scene.id, scene]));
  if (!unique.has("main")) unique.set("main", mainScene());
  const result = [...unique.values()].map(scene => ({
    ...scene,
    parent: scene.id === "main" ? null : scene.parent && unique.has(scene.parent) ? scene.parent : "main",
    components: normalizeComponents(scene),
  }));
  const byId = new Map(result.map(scene => [scene.id, scene]));
  for (const scene of result) {
    const visited = new Set([scene.id]);
    let parent = scene.parent;
    while (parent !== null) {
      if (visited.has(parent)) {
        scene.parent = "main";
        break;
      }
      visited.add(parent);
      parent = byId.get(parent)?.parent ?? null;
    }
  }
  return result;
}

export function sceneDepth(scenes: readonly Scene[], id: string): number {
  const byId = new Map(scenes.map(scene => [scene.id, scene]));
  const visited = new Set<string>();
  let depth = 0;
  let scene = byId.get(id);
  while (scene && scene.id !== "main" && !visited.has(scene.id)) {
    visited.add(scene.id);
    depth += 1;
    scene = byId.get(scene.parent ?? "main");
  }
  return depth;
}

export function sceneTree(scenes: readonly Scene[]): { scene: Scene; depth: number }[] {
  const root = scenes.find(scene => scene.id === "main");
  if (!root) return [];
  const rows: { scene: Scene; depth: number }[] = [];
  const pending = [{ scene: root, depth: 0 }];
  const visited = new Set<string>();
  while (pending.length) {
    const row = pending.pop()!;
    if (visited.has(row.scene.id)) continue;
    visited.add(row.scene.id);
    rows.push(row);
    pending.push(...sceneChildren(scenes, row.scene.id).reverse().map(scene => ({ scene, depth: row.depth + 1 })));
  }
  return rows;
}

export function sceneSubtreeIds(scenes: readonly Scene[], id: string): Set<string> {
  const ids = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const next = pending.pop()!;
    if (ids.has(next)) continue;
    ids.add(next);
    pending.push(...sceneChildren(scenes, next).map(scene => scene.id));
  }
  return ids;
}

export function canReparentScene(scenes: readonly Scene[], id: string, parent: string | null): boolean {
  return id !== "main" && parent !== null && scenes.some(scene => scene.id === parent)
    && !sceneSubtreeIds(scenes, id).has(parent);
}

function sceneLetter(ordinal: number): string {
  let label = "";
  for (let n = ordinal; n >= 0; n = Math.floor(n / 26) - 1)
    label = String.fromCharCode(65 + n % 26) + label;
  return label;
}

function sceneRoman(ordinal: number): string {
  const symbols: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let value = ordinal + 1;
  let label = "";
  for (const [amount, symbol] of symbols) {
    while (value >= amount) {
      label += symbol;
      value -= amount;
    }
  }
  return label;
}

export function nextSceneName(scenes: readonly Scene[], parentId = "main"): string {
  const depth = sceneDepth(scenes, parentId) + 1;
  const siblings = sceneChildren(scenes, parentId);
  for (let ordinal = 0;; ordinal += 1) {
    const suffix = depth === 1 ? sceneLetter(ordinal) : depth === 2 ? sceneRoman(ordinal) : String(ordinal + 1);
    const name = `Scene ${suffix}`;
    if (!siblings.some(scene => scene.name === name)) return name;
  }
}
