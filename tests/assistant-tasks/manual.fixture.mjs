import {
  ACCEPT_ALTERNATIVE,
  DECLINE_ALTERNATIVE,
} from "../../packages/pvo-assistant/tasks/index.js";
export const alternative = (overrides = {}) => ({
  capabilityId: "capability-one",
  originalOutcome: "Reserve a table",
  preparedOutcome: "Collect preferences for you to book",
  limitation:
    "This venue takes bookings by phone; no calling adapter is installed.",
  notice:
    "This collects preferences. A table still needs to be booked by a person.",
  fields: [
    {
      name: "guest",
      kind: "name",
      label: "Name",
      purpose: "Identify whose preference you will include in the call",
    },
  ],
  steps: [
    {
      id: "book",
      instruction: "Call the venue and record whether the table was booked.",
    },
  ],
  ...overrides,
});
export const manualQuestion = (proposal = alternative()) => ({
  id: "manual-choice",
  revision: 0,
  prompt: `Use this alternative? ${proposal.preparedOutcome}`,
  choices: [ACCEPT_ALTERNATIVE, DECLINE_ALTERNATIVE],
  alternative: proposal,
  answer: null,
});
export const manualAnswer = (value = ACCEPT_ALTERNATIVE) => ({
  kind: "answer",
  questionId: "manual-choice",
  questionRevision: 0,
  operationId: "accept-manual",
  value,
});
export const resolution = (overrides = {}) => ({
  kind: "resolve_manual",
  questionId: "manual-choice",
  stepId: "book",
  operationId: "resolve-book",
  status: "completed",
  note: "I called and the venue confirmed the table.",
  ...overrides,
});
