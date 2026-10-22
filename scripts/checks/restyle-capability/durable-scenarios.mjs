import assert from "node:assert/strict";
import { planningProbes } from "./probes.mjs";
import {
  expectStatus,
  path,
} from "../../../tests/assistant-task-server/helpers.mjs";

export function durableScenario(name) {
  if (name === "guestbook")
    return {
      request:
        planningProbes().find((item) => item.id === "P01").request +
        " Add a new form with name and message fields and a Save button to the main scene. Use a short duration and pause playback until submission. Keep the original request's storage and reading behavior.",
      connectionKey: null,
    };
  if (name === "connected-email")
    return {
      request:
        "Create a new Message in the main scene with one Send email button, no inputs, a short duration and pause until clicked. Use the already connected AgentMail sender email-sender to send the fixed subject Thanks and body Thanks for watching to its approved recipient friend@example.com. Use an immediate response, not scheduled or background delivery. After acceptance show the actual provider receipt ID in a visible Note. Do not claim delivery confirmation. Read https://docs.agentmail.to/api-reference/inboxes/messages/send for the adapter documentation.",
      connectionKey: "a".repeat(64),
      connectedEmail: true,
    };
  if (!["missing-email-account", "revoked-email-account"].includes(name))
    throw new Error(
      "Select guestbook, connected-email, missing-email-account, or revoked-email-account.",
    );
  return {
    request:
      "Build a viewer button that sends a fixed thank-you email through Restyle's AgentMail inbox to friend@example.com. Use subject Thanks and body Thanks for watching. " +
      (name === "missing-email-account"
        ? "No sender account is connected yet. "
        : "The saved sender connection has been revoked. ") +
      "Help me set it up privately. Never ask for credentials in chat or claim a message has already been sent.",
    connectionKey: "a".repeat(64),
    revoked: name === "revoked-email-account",
  };
}

export async function seedDurableScenario(fixture, scenario) {
  if (!scenario.revoked) return;
  expectStatus(
    await fixture.control({
      action: "save-connection",
      expectedRevision: 0,
      connection: {
        id: "revoked-sender",
        name: "Saved agent email",
        provider: "agentmail",
        status: "revoked",
        revision: 1,
        permissions: ["email:send"],
        operations: [
          { id: "agentmail_email_send", permissions: ["email:send"] },
        ],
      },
    }),
    200,
  );
}

/** No provider credentials are installed. A real saved question must open the scoped private setup. */
export async function checkDurableSetup(fixture, task) {
  assert.equal(
    task.state,
    "waiting_for_answer",
    "A missing/revoked account must wait for private setup.",
  );
  const pending = task.questions.find((question) => question.answer === null);
  assert.deepEqual(pending?.connection, {
    provider: "agentmail",
    recipient: "friend@example.com",
  });
  assert.equal(task.result, null);
  assert.deepEqual(
    (await fixture.control({ action: "connection-storage" })).body,
    [],
  );
  assert.deepEqual(
    (await fixture.control({ action: "service-catalog" })).body,
    [],
  );
  await fixture.restart();
  const restored = (await fixture.request(path(task))).body.task;
  assert.equal(restored.state, "waiting_for_answer");
  assert.deepEqual(restored.questions, task.questions);
  assert.equal(restored.usage.modelTurns, task.usage.modelTurns);
  return {
    privateSetup: pending.connection,
    preservedAcrossRestart: true,
    noCredentialOrServiceCreated: true,
  };
}
