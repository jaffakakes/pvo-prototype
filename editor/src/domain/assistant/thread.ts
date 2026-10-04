/** Visible exchanges are transient UI records, separate from planner history and project snapshots. */
export type AssistantThreadStatus = "pending" | "applied" | "answered" | "failed" | "cancelled";

export type AssistantThreadTarget =
  | { kind: "component"; sceneId: string; id: string; label: string }
  | { kind: "clip" | "text" | "audio"; sceneId: string; id: number; label: string };

export type AssistantExchange = {
  id: string;
  at: number;
  request: string;
  status: AssistantThreadStatus;
  response: string;
  progress: string;
  summary: string;
  target: AssistantThreadTarget | null;
  undone: boolean;
};

export const ASSISTANT_THREAD_LIMIT = 24;

/** A long service answer must not make one browser session grow without bound. */
export function assistantThreadText(value: string, limit = 8192): string {
  return value.trim().slice(0, limit);
}
