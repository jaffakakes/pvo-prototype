// Creator requests and acceptance examples only. No generated source or model decisions.
export const scenarios = {
  dinner: {
    request:
      "Create a dinner RSVP component for my friends. Save their names online and prevent more people joining than there are seats at my table. A name can only join once. I haven't told you the table size yet.",
    answer:
      "There are two seats. Ask for each guest's name. Keep this as an RSVP only; no restaurant reservation or messages. Show a useful response when full or already joined.",
    examples: [
      {
        id: "last-seat",
        input: "One guest has joined; two different guests submit together.",
        expected:
          "Exactly one gets the last seat. The other sees that dinner is full.",
      },
      {
        id: "repeat",
        input: "An accepted guest submits again, or a lost reply is retried.",
        expected: "No extra seat is taken.",
      },
    ],
  },
  equipment: {
    request:
      "Create a component where friends request my one camera for a range of dates. Collect their name, a start date and an end date written as YYYY-MM-DD. Save bookings online. Treat the end date as the return day: another booking may start on that day. Reject empty or reversed ranges and overlapping dates, including when two people request it together. This only saves requests; no payment or messages.",
    answer:
      "One camera. Start is inclusive and end is exclusive. YYYY-MM-DD dates, a name, no payment or messages. Accept valid free dates and explain invalid or overlapping requests.",
    examples: [
      {
        id: "overlap",
        input:
          "A booking already covers 2026-11-10 through the return day 2026-11-12. Another starts 2026-11-11 and ends 2026-11-13.",
        expected: "The second booking is rejected. The first stays saved.",
      },
      {
        id: "adjacent",
        input: "The next booking starts on 2026-11-12 and ends 2026-11-14.",
        expected: "It is accepted because it begins on the earlier return day.",
      },
      {
        id: "invalid",
        input: "Start and end are equal, reversed, or not real dates.",
        expected: "Reject the request without changing the saved bookings.",
      },
    ],
  },
};

export function scenarioInput(subject, projectId) {
  const scenario = scenarios[subject];
  if (!scenario) throw new Error("Unknown acceptance scenario.");
  return {
    operationId: `create-${subject}`,
    projectId,
    request: scenario.request,
    examples: scenario.examples,
    context: {
      fingerprint: "1f-empty-scene",
      currentSceneId: "scene-one",
      scenes: [{ id: "scene-one", name: "Main", duration: 10 }],
      components: [],
    },
  };
}
