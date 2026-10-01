import { create } from "zustand";
import type { LookPart } from "../../domain/components/look";
import type { PvoLanguageSource } from "../../domain/components/languageSource";

export type ComponentAuthoringTab = "content" | "look" | "action" | "advanced";
export const useComponentAuthoring = create<{
  componentId: string | null;
  tab: ComponentAuthoringTab;
  part: LookPart;
  sourcePart: keyof PvoLanguageSource;
}>(() => ({ componentId: null, tab: "content", part: "whole", sourcePart: "structure" }));

export function setComponentAuthoringTab(componentId: string, tab: ComponentAuthoringTab): void {
  useComponentAuthoring.setState(state => ({ componentId, tab, part: state.componentId === componentId ? state.part : "whole" }));
}
export function selectComponentLookPart(componentId: string, part: LookPart): void {
  useComponentAuthoring.setState({ componentId, tab: "look", part });
}

export function selectComponentSourcePart(componentId: string, sourcePart: keyof PvoLanguageSource): void {
  setComponentAuthoringTab(componentId, "advanced");
  useComponentAuthoring.setState({ sourcePart });
}
