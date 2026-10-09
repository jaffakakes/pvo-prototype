import { taskFixture, NOW, ORIGIN } from "../assistant-task-server/helpers.mjs";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { linkClerkAccount } from "../../server/auth/clerkAccounts.js";

export const MAIL_KEY = "am_us_synthetic_private_identity_key_123456789";
export const PHONE_KEY = "sk_live_synthetic_private_identity_key_123456789";
export const ADDRESS = "restyle-agent@agentmail.to";
export const CLERK_ISSUER = "https://identity-fixture.clerk.accounts.dev";
const signingKeys = generateKeyPair("RS256");

export async function identityToken(changes = {}) {
  const { privateKey } = await signingKeys;
  return new SignJWT({
    azp: ORIGIN,
    sub: "user_identityowner",
    sid: "sess_identityowner",
    restyle_email: "owner@example.com",
    restyle_email_verified: true,
    ...changes,
  })
    .setProtectedHeader({ alg: "RS256", kid: "identity-fixture" })
    .setIssuer(CLERK_ISSUER)
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
    if (url.hostname === "consumer.test")
      return Response.json({ accepted: true });
    const mail = url.hostname === "api.agentmail.to";
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
    clerk: {
      issuer: CLERK_ISSUER,
      fetch: async (request) => {
        if (request.url !== `${CLERK_ISSUER}/.well-known/jwks.json`)
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
  await linkClerkAccount(
    { issuer: CLERK_ISSUER, sub: "user_identityowner" },
    { id: owner },
    await f.database(),
  );
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
