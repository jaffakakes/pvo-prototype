import {
  connectedAgreement,
  connectedSource,
  record,
  field,
  string,
} from "../connected-services/fixtures.mjs";
export const EMAIL_ID = "12345678-1234-1234-1234-123456789012";
export const EMAIL_KEY = "re_synthetic_key_never_real_123456789";
export const WEBHOOK_SECRET = "whsec_" + Buffer.alloc(32, 7).toString("base64");
export const emailInput = {
  subject: "Restyle acceptance test",
  text: "Restyle test: your acceptance was recorded.",
};
export const emailSetup = {
  provider: "resend",
  from: "sender@example.com",
  recipient: "owner@example.com",
};
export const emailConnect = () => ({
  id: "connection-one",
  expectedRevision: 0,
  setup: emailSetup,
  token: JSON.stringify({ key: EMAIL_KEY, webhookSecret: WEBHOOK_SECRET }),
});
export function emailFixture() {
  const agreement = connectedAgreement();
  const adapter = {
    ...agreement.connections[0].adapter,
    name: "sendEmail",
    provider: "resend",
    method: "POST",
    path: ["emails"],
    query: [],
    input: record(field("subject", string(256)), field("text", string(4096))),
    result: record(field("id", string(36))),
    permission: "email:send",
    documentation: "https://resend.com/docs/api-reference/emails/send-email",
  };
  agreement.description =
    "Record a guest's acceptance and email the creator through their approved account.";
  agreement.operations[0] = {
    ...agreement.operations[0],
    delivery: "background",
    access: "write",
    input: adapter.input,
    result: string(36),
  };
  agreement.connections[0] = {
    ...agreement.connections[0],
    adapter,
    examples: [{ input: emailInput, result: { id: EMAIL_ID } }],
  };
  agreement.cases[0].steps[0] = {
    ...agreement.cases[0].steps[0],
    input: emailInput,
    requests: [{ connection: "issue", input: emailInput }],
    expected: { result: EMAIL_ID, state: null },
  };
  return {
    agreement,
    source: connectedSource().files[0].content.replace(
      ".result.title",
      ".result.id",
    ),
  };
}
export function emailProvider() {
  const state = {
    calls: [],
    accepted: new Map(),
    sends: 0,
    event: "sent",
    lost: false,
    reject: false,
    offline: false,
  };
  state.fetch = async (request) => {
    state.calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
    });
    if (state.offline) throw new Error("Synthetic sender is offline");
    if (state.reject) return Response.json({}, { status: 401 });
    if (request.method === "POST") {
      const key = request.headers.get("Idempotency-Key"),
        body = await request.json();
      if (!state.accepted.has(key)) {
        state.accepted.set(key, body);
        state.sends++;
      }
      if (state.lost) {
        state.lost = false;
        return Response.json({}, { status: 503 });
      }
      return Response.json({ id: EMAIL_ID });
    }
    if (new URL(request.url).pathname === `/emails/${EMAIL_ID}`)
      return Response.json({ id: EMAIL_ID, last_event: state.event });
    return Response.json({ data: [] });
  };
  return state;
}
