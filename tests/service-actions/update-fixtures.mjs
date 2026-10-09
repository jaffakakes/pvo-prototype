export function counterAgreement(maximum = 10, increment = 1, initial = 0) {
  return {
    description: "Keep a shared count.",
    state: { schema: { type: "integer", minimum: 0, maximum }, initial },
    operations: [
      {
        name: "increment",
        description: "Add to the count.",
        audience: "public",
        access: "write",
        input: { type: "null" },
        result: { type: "integer", minimum: 0, maximum: 100 },
      },
    ],
    cases: [
      {
        id: "increment",
        description: "Add to an empty counter.",
        initialState: 0,
        steps: [
          {
            operation: "increment",
            input: null,
            now: 1,
            expected: { result: increment, state: increment },
          },
        ],
      },
    ],
  };
}
export const counterSource = (increment = 1) =>
  `export function execute({state}) {const next=state+${increment};return {result:next,state:next};}`;
export const increment = (actionId) => ({
  actionId,
  operation: "increment",
  input: null,
});
