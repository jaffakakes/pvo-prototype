export const evidencePage = {
  url: "https://calendar.example.com/docs/availability",
  title: "Availability API",
  text: "Read free/busy intervals for a calendar. Requires a connected account with calendar.read permission.",
  links: [],
  retrievedAt: "2026-10-08T10:00:00.000Z",
  truncated: false,
};

export const evidenceNote = (overrides = {}) => ({
  kind: "web_evidence",
  sourceOperationId: "read-availability",
  operation: "Show the creator's free times to a visitor",
  support: "documented",
  excerpts: [
    "Read free/busy intervals for a calendar.",
    "Requires a connected account with calendar.read permission.",
  ],
  accessRequirements: ["Connected account with calendar.read permission"],
  uncertainty: ["The creator's account access has not been checked."],
  stillNeedsTesting: [
    "Use a test calendar to verify free/busy results and timezone handling.",
  ],
  ...overrides,
});
