import { taskFixture, NOW } from "../assistant-task-server/helpers.mjs";

export const MAIL_KEY = "am_us_synthetic_private_identity_key_123456789";
export const PHONE_KEY = "sk_live_synthetic_private_identity_key_123456789";
export const ADDRESS = "restyle-agent@agentmail.to";

export async function identityFixture() {
  const api = {
    calls: [],
    failVerify: false,
    hold: null,
    lostVerify: false,
    revoked: false,
    unavailable: false,
  };
  const fetcher = async (request) => {
    const url = new URL(request.url),
      path = url.pathname;
    const body = request.method === "POST" ? await request.json() : null;
    api.calls.push({
      path,
      body,
      provider: url.hostname,
      token: request.headers.get("Authorization"),
    });
    if (api.hold) await api.hold;
    const mail = url.hostname === "api.agentmail.to";
    if (path === "/v0/agent/human")
      return Response.json({
        human_email: body.human_email,
        instructions: "verify",
      });
    if (path === "/v0/inboxes")
      return Response.json({
        inboxes: [{ inbox_id: ADDRESS, email: ADDRESS, status: "active" }],
        count: 1,
      });
    if (path === "/v1/numbers")
      return Response.json({
        data: [
          { id: "number-one", phoneNumber: "+14155550123", status: "active" },
        ],
        hasMore: false,
      });
    if (api.revoked && request.method === "GET")
      return Response.json({ message: MAIL_KEY }, { status: 401 });
    if (api.unavailable && request.method === "GET")
      return Response.json({ error: "temporary" }, { status: 503 });
    if (path.endsWith("/sign-up"))
      return Response.json(
        mail
          ? { organization_id: "org-one", inbox_id: ADDRESS, api_key: MAIL_KEY }
          : {
              verification_id: "ver-one",
              expires_at: new Date(NOW + 3600000).toISOString(),
            },
      );
    if (path.endsWith("/verify")) {
      if (api.failVerify)
        return Response.json({ message: "bad code" }, { status: 400 });
      if (api.lostVerify)
        return Response.json({ message: "unknown" }, { status: 500 });
      return Response.json(
        mail
          ? { verified: true }
          : {
              account_id: "account-one",
              agent_id: "agent-one",
              number_id: "number-one",
              phone_number: "+14155550123",
              api_key: PHONE_KEY,
            },
      );
    }
    return Response.json(
      mail
        ? {
            inbox_id: ADDRESS,
            email: ADDRESS,
            pod_id: "pod-one",
            status: "active",
          }
        : { id: "number-one", phoneNumber: "+14155550123", status: "active" },
    );
  };
  const f = await taskFixture({
    clock: NOW,
    connectionKey: "a".repeat(64),
    connectionFetch: fetcher,
  });
  const owner = (await f.request("/api/auth/session")).body.user.id;
  return {
    ...f,
    api,
    owner,
    identity: (kind, body, options = {}) =>
      f.request(`/api/agent-identity${kind === "list" ? "" : `/${kind}`}`, {
        ...options,
        ...(kind === "list" ? {} : { body }),
        headers: { "X-Restyle-Owner": owner, ...options.headers },
      }),
  };
}
export const start = (provider = "agentmail") => ({
  provider,
  expectedRevision: 0,
  humanEmail: "owner@example.com",
  name: "restyle-agent",
  consent: true,
  monthlyNumberCents: provider === "agentphone" ? 300 : 0,
});
