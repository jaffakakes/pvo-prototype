import type { CompiledPvoComponent, PvoLanguageRule } from "../../../../packages/pvo-language/index.js";
import { checkedDomains, requestBody, requestHost } from "../components/actions";

type Context = { sceneIds: readonly string[]; duration: number; requestDomains?: readonly string[] };

/** Compiler-valid routes still need the selected project's scenes and timing. */
export function validateAssistantContext(compiled: Pick<CompiledPvoComponent, "rules">, context: Context): void {
  if (!Number.isFinite(context.duration) || context.duration < 0)
    throw new Error("The selected scene has no valid duration.");
  const available = new Set(context.sceneIds);
  const requestDomains = context.requestDomains && new Set(checkedDomains([...context.requestDomains]));
  const check = (action: PvoLanguageRule["action"]) => {
    if (action.kind === "scene" && !available.has(action.sceneId))
      throw new Error(`The proposal links to an empty or missing scene: ${action.sceneId}.`);
    if (action.kind === "time" && (!Number.isFinite(action.t) || action.t < 0 || action.t > context.duration))
      throw new Error("The proposal jumps outside the selected scene's video.");
    if (action.kind === "request") {
      const host = requestHost(action.url);
      requestBody(action.body);
      if (requestDomains && !requestDomains.has(host))
        throw new Error(`Add this request destination in the component editor first: ${host}.`);
      check(action.onSuccess);
      if (action.onError) check(action.onError);
    }
  };
  for (const rule of compiled.rules) check(rule.action);
}
