/** Fresh complete requests, with exact visible/behavioral outcomes declared before inference. */
export function pressureJourney(name) {
  const common =
    " Add one new Form in main at 0 seconds, duration 3 seconds, pausing until submitted. Keep stored data after reopening. Show the result in a visible Note. Do not change the original clip. ";
  const cases = {
    "pressure-quiz": {
      request:
        "Create a quiz using supplied facts only: 2+5=7. One number field named answer, label Answer, button Check. Public submit scores exactly 7 as Correct and every other number as Try again. No state, network, or accounts." +
        common,
      inputs: [{ answer: 9 }, { answer: 7 }],
      expected: ["Try again", "Correct"],
    },
    "pressure-feedback": {
      request:
        "Create private feedback with one short text field named feedback, exact label ملاحظاتك الخاصة — your private feedback, button Save. Trim input; blank => Invalid; otherwise retain up to 20 messages privately, return Saved, reject further entries with Full. Public submit must NEVER return stored messages. Creator-only read may list them. No emails/accounts/network." +
        common,
      inputs: [{ feedback: "Private Ω first" }, { feedback: "Private second" }],
      expected: ["Saved", "Saved"],
      privateFeedback: true,
    },
    "pressure-waitlist": {
      request:
        "Create a workshop waitlist form: name field named name, label Name; yesno field named cancel, label Cancel my place, default unchecked. One submit button Update. Capacity one, up to eight waiting names. Trim, case-sensitive, reject blank Invalid. Unchecked joins; duplicates in active or waiting => Duplicate, otherwise accepted => Accepted or queued => Waiting. Checked cancels; active cancellation promotes oldest waiting. Cancellation => Cancelled or absent => Absent. Full waitlist => Full. Return status only, no people's names. No external booking or email." +
        common,
      inputs: [
        { name: "Ari", cancel: false },
        { name: "Bo", cancel: false },
        { name: "Ari", cancel: true },
      ],
      expected: ["Accepted", "Waiting", "Cancelled"],
    },
    "pressure-optional-email": {
      request:
        "Create private feedback with short field feedback labelled Feedback and yesno field email labelled Email my friend, unchecked by default. Button Save. Trim/reject blank Invalid; store up to 20 messages privately; full => Full. When email is false, store only and return Saved. When true, use connected AgentMail sender email-sender, approved recipient friend@example.com, fixed subject Thanks and fixed body Thanks for watching. Send once per submission, show actual accepted receipt, never claim delivery. No public read of feedback. Read https://docs.agentmail.to/api-reference/inboxes/messages/send ." +
        common,
      inputs: [
        { feedback: "Store only", email: false },
        { feedback: "Send requested", email: true },
      ],
      expected: ["Saved", "<reliability-message@agentmail.to>"],
      connectedEmail: true,
      connectionKey: "a".repeat(64),
    },
  };
  return cases[name]
    ? { ...cases[name], pressure: true, connectionKey: null, ...cases[name] }
    : null;
}
