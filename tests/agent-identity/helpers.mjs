import { taskFixture, NOW, ORIGIN } from "../assistant-task-server/helpers.mjs";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";

export const MAIL_KEY = "am_us_synthetic_private_identity_key_123456789";
export const PHONE_KEY = "sk_live_synthetic_private_identity_key_123456789";
export const ADDRESS = "restyle-agent@agentmail.to";
export const SUPABASE_URL = "https://identity-fixture.supabase.co";
const SUBJECT = "00000000-0000-4000-8000-000000000001";
const signingKeys = generateKeyPair("RS256");

export async function identityToken(changes = {}) {
  const { privateKey } = await signingKeys;
  return new SignJWT({
    sub: SUBJECT,
    session_id: "00000000-0000-4000-8000-000000000002",
    role: "authenticated",
    is_anonymous: false,
    email: "owner@example.com",
    email_confirmed_at: new Date().toISOString(),
    ...changes,
  })
    .setProtectedHeader({ alg: "RS256", kid: "identity-fixture" })
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1m")
    .sign(privateKey);
}

export async function identityFixture() {
  const api = {
    calls: [],
    failVerify: false,
    hold: null,
    lostVerify: false,
    revoked: false,
    unavailable: false,
    messages: [],
    moreMessages: false,
    sent: new Map(),
    loseSend: false,
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
      idempotencyKey: request.headers.get("Idempotency-Key"),
    });
    if (api.hold) await api.hold;
    if (url.hostname === "consumer.test")
      return Response.json({ accepted: true });
    const mail = url.hostname === "api.agentmail.to";
    if (mail && path.endsWith("/messages/send")) {
      const key = request.headers.get("Idempotency-Key");
      const previous = api.sent.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(body))
        return Response.json({}, { status: 409 });
      api.sent.set(key, body);
      if (api.loseSend) {
        api.loseSend = false;
        return Response.json({}, { status: 503 });
      }
      return Response.json({
        message_id: "<message-one@agentmail.to>",
        thread_id: "thread-one",
      });
    }
    if (path.includes("/messages")) {
      if (path.endsWith("/messages"))
        return Response.json(
          mail
            ? {
                messages: api.messages,
                next_page_token: api.moreMessages ? "more" : null,
              }
            : { data: api.messages, hasMore: api.moreMessages },
        );
      return Response.json(
        api.messages.find(
          (entry) =>
            entry.message_id === decodeURIComponent(path.split("/").at(-1)),
        ),
      );
    }
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
    supabase: {
      url: SUPABASE_URL,
      fetch: async (request) => {
        if (request.url === `${SUPABASE_URL}/auth/v1/user`) {
          const token = request.headers.get("Authorization").slice(7);
          const claims = decodeJwt(token);
          return Response.json({ ...claims, id: claims.sub });
        }
        if (request.url !== `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
          throw new Error("Unexpected authentication destination");
        const { publicKey } = await signingKeys;
        return Response.json({
          keys: [
            {
              ...(await exportJWK(publicKey)),
              alg: "RS256",
              kid: "identity-fixture",
            },
          ],
        });
      },
    },
  });
  const owner = (await f.request("/api/auth/session")).body.user.id;
  await (
    await f.database()
  )
    .prepare(
      "INSERT INTO supabase_identities (issuer, subject, user_id) VALUES (?, ?, ?)",
    )
    .bind(`${SUPABASE_URL}/auth/v1`, SUBJECT, owner)
    .run();
  return {
    ...f,
    api,
    owner,
    identity: async (kind, body, options = {}) =>
      f.request(`/api/agent-identity${kind === "list" ? "" : `/${kind}`}`, {
        ...options,
        ...(kind === "list" ? {} : { body }),
        headers: {
          "X-Restyle-Owner": owner,
          ...(kind === "start"
            ? { Authorization: `Bearer ${await identityToken()}` }
            : {}),
          ...options.headers,
        },
      }),
  };
}
export const start = (provider = "agentmail") => ({
  provider,
  expectedRevision: 0,
  consent: true,
  monthlyNumberCents: provider === "agentphone" ? 300 : 0,
});
