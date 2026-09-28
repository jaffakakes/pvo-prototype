import { create } from "zustand";

type Feedback = { operation: number; phase: "pending" | "failed" | "emptyScene" };
export const useTryFeedback = create<{ components: Record<string, Feedback> }>(() => ({ components: {} }));
let nextOperation = 0;

export function beginTryRequest(componentId: string): number {
  const operation = ++nextOperation;
  useTryFeedback.setState(state => ({
    components: { ...state.components, [componentId]: { operation, phase: "pending" } },
  }));
  return operation;
}

export function finishTryRequest(componentId: string, operation: number, failed: boolean): void {
  useTryFeedback.setState(state => {
    if (state.components[componentId]?.operation !== operation) return state;
    const components = { ...state.components };
    if (failed) components[componentId] = { operation, phase: "failed" };
    else delete components[componentId];
    return { components };
  });
}

export function reportEmptyScene(componentId: string): void {
  useTryFeedback.setState(state => ({
    components: { ...state.components, [componentId]: { operation: ++nextOperation, phase: "emptyScene" } },
  }));
}

export function clearTryFeedback(): void {
  useTryFeedback.setState({ components: {} });
}
