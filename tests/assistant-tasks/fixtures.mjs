import {
  createTask,
  transitionTask,
} from "../../packages/pvo-assistant/tasks/index.js";

export const now = 1_790_000_000_000;
export const hash = "a".repeat(64);
export const ownerId = "owner-one";
export function input() {
  return {
    operationId: "create-one",
    projectId: "project-one",
    request: "Build a dinner RSVP with six places.",
    examples: [
      {
        id: "last-place",
        input: "Five accepted guests; two new guests accept together.",
        expected: "Only one of them receives the last place.",
      },
    ],
    context: {
      fingerprint: "100-abc-def",
      components: [
        {
          id: "form-one",
          sceneId: "scene-one",
          type: "form",
          source: { structure: "form", style: "", logic: "" },
        },
      ],
    },
  };
}
export const create = () =>
  createTask(input(), { id: "task-one", ownerId, now, inputDigest: hash });
export function command(task, change, options = {}) {
  return transitionTask(task, change, {
    ownerId,
    expectedRevision: task.revision,
    now: task.updatedAt + 1,
    claim: task.claim
      ? { id: task.claim.id, generation: task.generation }
      : null,
    ...options,
  });
}
export const claim = (task) =>
  command(task, { kind: "claim", claimId: "worker-one", leaseMs: 60_000 });
export const question = () => ({
  id: "date",
  revision: 0,
  prompt: "Which day?",
  choices: ["Friday", "Saturday"],
  answer: null,
});
export const answer = () => ({
  kind: "answer",
  questionId: "date",
  questionRevision: 0,
  operationId: "answer-date",
  value: "Friday",
});
export const result = () => ({
  artifact: { id: "prepared-one", sha256: hash, bytes: 123 },
  baseFingerprint: "100-abc-def",
});
export const operation = (task) => ({
  id: "build-one",
  stepId: task.stepId,
  inputDigest: hash,
  status: "planned",
  resources: [],
  artifact: null,
  failure: null,
  createdAt: task.updatedAt + 1,
  updatedAt: task.updatedAt + 1,
});
