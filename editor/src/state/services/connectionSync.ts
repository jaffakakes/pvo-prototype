import { create } from "zustand";

export const useConnectionSync = create<{
  scope: string | null;
  phase: "idle" | "pending" | "saved" | "failed";
  error: string | null;
  retry: number;
}>(() => ({ scope: null, phase: "idle", error: null, retry: 0 }));
export function retryConnectionSync() {
  useConnectionSync.setState((state) => ({ retry: state.retry + 1 }));
}
