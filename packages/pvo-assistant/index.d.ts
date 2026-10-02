export type AssistantSource = { structure: string; style: string; logic: string };
export type AssistantContext = {
  currentSceneId: string;
  duration: number;
  scenes: { id: string; name: string }[];
};
export const ASSISTANT_SOURCE_MAX_BYTES: 20000;
export const ASSISTANT_MAX_SCENES: 100;
