import { taskFixture, NOW } from "../assistant-task-server/helpers.mjs";
export const TOKEN = "github_pat_synthetic_connection_key_never_real_123456789";
export const KEY = "a".repeat(64);
export const setup = { provider: "github", repository: "octocat/private-work" };
export function provider() {
  const state = {
    calls: [],
    reject: false,
    expiresAt: NOW + 86400000,
    held: null,
  };
  state.fetch = async (request) => {
    state.calls.push({
      url: request.url,
      method: request.method,
      token: request.headers.get("Authorization"),
    });
    if (state.held) await state.held;
    if (state.reject) return Response.json({ message: TOKEN }, { status: 401 });
    const path = new URL(request.url).pathname;
    const body =
      path === "/user"
        ? { id: 123, login: "octocat" }
        : path.endsWith("/issues")
          ? [{ number: 1, title: "Example issue", state: "open" }]
          : {
              full_name: setup.repository,
              private: true,
              open_issues_count: 1,
            };
    return Response.json(body, {
      headers: {
        "github-authentication-token-expiration": new Date(
          state.expiresAt,
        ).toUTCString(),
      },
    });
  };
  return state;
}
export async function fixture(options = {}) {
  const api = provider();
  const f = await taskFixture({
    clock: NOW,
    connectionKey: KEY,
    connectionFetch: api.fetch,
    ...options,
  });
  const owner = (await f.request("/api/auth/session")).body.user.id;
  const other = (
    await f.request("/api/auth/session", { session: f.otherCookie })
  ).body.user.id;
  return {
    ...f,
    api,
    owner,
    connection: (kind, body, options = {}) =>
      f.request(`/api/account-connections/${kind}`, {
        ...options,
        body,
        headers: {
          "X-Restyle-Owner": options.session === f.otherCookie ? other : owner,
          ...options.headers,
        },
      }),
    list: () =>
      f.request("/api/account-connections", {
        headers: { "X-Restyle-Owner": owner },
      }),
  };
}
export const connectInput = (id = "connection-one", expectedRevision = 0) => ({
  id,
  expectedRevision,
  setup,
  token: TOKEN,
});
