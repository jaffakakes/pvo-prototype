export const supabaseUrl = "https://restyle-test.supabase.co";
export const publishableKey = "sb_publishable_browser_fixture";
const storageKey = "restyle-auth-restyle-test";

function session(email) {
  const user = { id: email === "old@example.test" ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222",
    email, email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false, app_metadata: {}, user_metadata: {}, aud: "authenticated" };
  const payload = Buffer.from(JSON.stringify({ sub: user.id, email, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return { user, access_token: `eyJhbGciOiJFUzI1NiJ9.${payload}.fixture`, refresh_token: "fixture-refresh",
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer" };
}

/** Mock Auth HTTP responses while exercising the actual Supabase SDK and native forms. */
export async function installSupabaseFixture(context, existingEmail = null) {
  const state = { session: existingEmail ? session(existingEmail) : null, confirmationRequired: false,
    failPassword: false, recoveryCalls: 0, passwordUpdates: 0, signups: 0, blockPassword: null };
  if (state.session) await context.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: storageKey, value: state.session });
  await context.route(`${supabaseUrl}/auth/v1/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON();
    const reply = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (request.method() === "OPTIONS") return reply({});
    if (url.pathname.endsWith("/token")) {
      if (url.searchParams.get("grant_type") === "pkce" && !body.code_verifier)
        return reply({ msg: "Missing PKCE verifier" }, 400);
      if (state.blockPassword) await state.blockPassword;
      if (state.failPassword) return reply({ msg: "Invalid login credentials" }, 400);
      state.session = session(body?.email || "recovery@example.test");
      return reply(state.session);
    }
    if (url.pathname.endsWith("/signup")) {
      state.signups++;
      const signed = session(body.email);
      if (state.confirmationRequired) return reply({ ...signed.user, email_confirmed_at: undefined });
      state.session = signed;
      return reply(signed);
    }
    if (url.pathname.endsWith("/recover")) {
      if (!body.code_challenge || !url.searchParams.get("redirect_to")?.endsWith("/editor/?auth=recovery"))
        throw new Error("Recovery must bind PKCE to the editor callback");
      state.recoveryCalls++; return reply({});
    }
    if (url.pathname.endsWith("/logout")) { state.session = null; return route.fulfill({ status: 204 }); }
    if (url.pathname.endsWith("/user")) {
      if (request.method() === "PUT") state.passwordUpdates++;
      return reply(state.session?.user || {}, state.session ? 200 : 401);
    }
    throw new Error(`Unexpected Supabase operation ${request.method()} ${url.pathname}`);
  });
  return state;
}

export async function fillEmailForm(container, email) {
  await container.getByLabel("Email address", { exact: true }).fill(email);
  await container.getByLabel("Password", { exact: true }).fill("fixture-password");
  await container.locator('button[type="submit"]').click();
}
