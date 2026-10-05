import {
  createTask,
  parseTaskRecord,
  transitionTask,
  type TaskCommand,
  type TaskRecord,
} from "../../packages/pvo-assistant/tasks/index.js";

const task: TaskRecord = createTask({} as unknown, {
  id: "task",
  ownerId: "owner",
  now: 1,
  inputDigest: "digest",
});
const parsed: TaskRecord = parseTaskRecord(task);
const next: TaskRecord = transitionTask(
  parsed,
  { kind: "claim", claimId: "worker", leaseMs: 1000 },
  {
    ownerId: "owner",
    expectedRevision: parsed.revision,
    now: 1,
    claim: null,
  },
);
const stop: TaskCommand = { kind: "stop" };
void next;
void stop;
// @ts-expect-error Ownership is trusted metadata and is not part of a command.
const forged: TaskCommand = { kind: "stop", ownerId: "other" };
// @ts-expect-error Settlements require an explicit consumed/refunded decision.
const incomplete: TaskCommand = {
  kind: "settle_usage",
  modelTurns: 1,
  toolCalls: 0,
};
// @ts-expect-error Prepared source uses a typed external artifact reference.
const invalid: TaskCommand = { kind: "complete", result: "arbitrary source" };
void forged;
void incomplete;
void invalid;
