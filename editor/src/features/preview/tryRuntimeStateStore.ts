import { create } from "zustand";

type TryRuntimeState = {
  value: Record<string, unknown> | null;
};

/** Session-only PVO state used by reactive component presentation in Try mode. */
export const useTryRuntimeState = create<TryRuntimeState>(() => ({ value: null }));

export function publishTryRuntimeState(value: Record<string, unknown>): void {
  useTryRuntimeState.setState({ value });
}

export function clearTryRuntimeState(): void {
  useTryRuntimeState.setState({ value: null });
}
