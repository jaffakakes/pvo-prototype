import { create } from "zustand";
import type { ComponentDimensions } from "../../../../packages/pvo-component-runtime/index.js";

/** Transient natural canvas bounds shared by the preview and the size inspector. */
export const useComponentMeasurements = create<{ sizes: Record<string, ComponentDimensions> }>(() => ({ sizes: {} }));

export function measureComponent(id: string, size: ComponentDimensions) {
  const previous = useComponentMeasurements.getState().sizes[id];
  if (previous?.width === size.width && previous.height === size.height) return;
  useComponentMeasurements.setState(state => ({ sizes: { ...state.sizes, [id]: size } }));
}

export function forgetComponentMeasurement(id: string) {
  useComponentMeasurements.setState(state => {
    const sizes = { ...state.sizes };
    delete sizes[id];
    return { sizes };
  });
}
