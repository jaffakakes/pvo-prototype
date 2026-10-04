import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({ stdin: { contents: `
  export { exchangeClerkSession, getAccountSession, linkClerkSession } from "./editor/src/infrastructure/auth/client.ts";
  export { closeAuthGate, refreshAccountSession, refreshAccountSessionAfterSignIn, requireAccount, signOutAccount, useAuthGate } from "./editor/src/state/auth/authGateStore.ts";
  export { resetExportArtifact, useExportArtifact } from "./editor/src/state/export/exportArtifactStore.ts";
`, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser" });
const { closeAuthGate, exchangeClerkSession, getAccountSession, linkClerkSession, refreshAccountSession, refreshAccountSessionAfterSignIn,
  requireAccount, resetExportArtifact,
  signOutAccount, useAuthGate, useExportArtifact } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; });

const accountSession = user => ({ available: true, user, clerkAvailable: false,
  clerkPublishableKey: null, canLinkEmail: false, emailLinked: false });

test("account gate waits for verified sign-in and resumes the intended action", async () => {
  let signedIn = false;
  globalThis.fetch = async (_path, init) => {
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.redirect, "error");
    return Response.json(accountSession(signedIn ? { id: "person-1", name: "Christina" } : null));
  };
  const allowed = requireAccount("export");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(useAuthGate.getState().source, "export");
  assert.equal(useAuthGate.getState().user, null);
  signedIn = true;
  await refreshAccountSession();
  assert.equal(await allowed, true);
  assert.equal(useAuthGate.getState().source, null);
  assert.deepEqual(useAuthGate.getState().user, { id: "person-1", name: "Christina" });
});

test("dismissal cancels the queued export and a new action checks the live session", async () => {
  globalThis.fetch = async () => Response.json(accountSession(null));
  const allowed = requireAccount("download");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(useAuthGate.getState().source, "download");
  closeAuthGate();
  assert.equal(await allowed, false);
  assert.equal(useAuthGate.getState().source, null);
  assert.equal((await getAccountSession()).user, null);
});

test("unconfigured sign-in cannot be mistaken for an authenticated session", async () => {
  globalThis.fetch = async () => new Response("Not found", { status: 404 });
  assert.deepEqual(await getAccountSession(), { available: false, user: null, clerkAvailable: false,
    clerkPublishableKey: null, canLinkEmail: false, emailLinked: false });
  globalThis.fetch = async () => Response.json(accountSession({ id: 123, name: "Bad" }));
  await assert.rejects(getAccountSession(), /invalid response/);
});

test("email sign-in exchanges only a Clerk session token through the same-origin account endpoint", async () => {
  globalThis.fetch = async (path, init) => {
    assert.equal(path, "/api/auth/clerk/exchange");
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, "Bearer short-lived-token");
    assert.equal(init.body, undefined);
    return Response.json({ user: { id: "account-a", name: "Alice" } });
  };
  await exchangeClerkSession("short-lived-token");
});

test("email linking sends the reviewed Restyle account and handles an identity conflict", async () => {
  let status = 200;
  globalThis.fetch = async (path, init) => {
    assert.equal(path, "/api/auth/clerk/link");
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, "Bearer reviewed-token");
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(init.body), { expectedUserId: "reviewed-user" });
    return Response.json({ user: null }, { status });
  };
  await linkClerkSession("reviewed-token", "reviewed-user");
  status = 409;
  await assert.rejects(linkClerkSession("reviewed-token", "reviewed-user"),
    /already connected to another Restyle account/);
  status = 412;
  await assert.rejects(linkClerkSession("reviewed-token", "reviewed-user"),
    /Restyle account changed/);
});

test("provider exchange ignores an account check started before its new cookie existed", async () => {
  let releaseOldCheck;
  const oldCheckReady = new Promise(resolve => { releaseOldCheck = resolve; });
  let checks = 0;
  globalThis.fetch = async () => {
    checks++;
    if (checks === 1) {
      await oldCheckReady;
      return Response.json(accountSession(null));
    }
    return Response.json(accountSession({ id: "email-1", name: "Email creator" }));
  };
  const staleCheck = refreshAccountSession();
  const signedIn = await refreshAccountSessionAfterSignIn();
  assert.equal(signedIn.user.id, "email-1");
  releaseOldCheck();
  assert.equal((await staleCheck).user.id, "email-1");
  assert.equal(useAuthGate.getState().user.id, "email-1");
  assert.equal(checks, 2);
});

test("sign-out and account changes forget account-owned links while retaining the local export", async () => {
  const artifact = { snapshotId: "local-export" };
  const publication = { id: "old-account-link", status: "ready" };
  const first = { id: "account-a", name: "Alice" };
  useAuthGate.setState({ user: first });
  useExportArtifact.setState({ artifact, publication, publicationKey: "old-key", publicationTitle: "Old title" });
  globalThis.fetch = async (_path, init) => {
    assert.equal(init.method, "POST");
    return Response.json({ user: null });
  };
  await signOutAccount();
  assert.equal(useAuthGate.getState().user, null);
  assert.equal(useExportArtifact.getState().artifact, artifact);
  assert.equal(useExportArtifact.getState().publication, null);
  assert.equal(useExportArtifact.getState().publicationTitle, null);
  assert.notEqual(useExportArtifact.getState().publicationKey, "old-key");

  useAuthGate.setState({ user: first });
  useExportArtifact.setState({ publication, publicationKey: "another-old-key", publicationTitle: "Old title" });
  globalThis.fetch = async (_path, init) => {
    assert.equal(init.method, "GET");
    return Response.json(accountSession({ id: "account-b", name: "Bob" }));
  };
  await refreshAccountSession();
  assert.equal(useAuthGate.getState().user.id, "account-b");
  assert.equal(useExportArtifact.getState().artifact, artifact);
  assert.equal(useExportArtifact.getState().publication, null);
  assert.equal(useExportArtifact.getState().publicationTitle, null);
  assert.notEqual(useExportArtifact.getState().publicationKey, "another-old-key");
  resetExportArtifact();
});

test("a failed account check forgets the previous account's ready link", async () => {
  const artifact = { snapshotId: "saved-export" };
  const publication = { id: "account-a-link", status: "ready" };
  useAuthGate.setState({ user: { id: "account-a", name: "Alice" }, phase: "ready", available: true });
  useExportArtifact.setState({ artifact, publication, publicationKey: "account-a-key", publicationTitle: "Alice's link" });
  globalThis.fetch = async () => { throw new Error("Account service unavailable"); };

  await assert.rejects(refreshAccountSession(), /Account service unavailable/);
  assert.equal(useAuthGate.getState().phase, "error");
  assert.equal(useAuthGate.getState().user, null);
  assert.equal(useExportArtifact.getState().artifact, artifact);
  assert.equal(useExportArtifact.getState().publication, null);
  assert.equal(useExportArtifact.getState().publicationTitle, null);
  assert.notEqual(useExportArtifact.getState().publicationKey, "account-a-key");

  globalThis.fetch = async () => Response.json(accountSession({ id: "account-b", name: "Bob" }));
  await refreshAccountSession();
  assert.equal(useAuthGate.getState().user.id, "account-b");
  assert.equal(useExportArtifact.getState().publication, null);
  resetExportArtifact();
});

test("a pre-logout account check cannot restore the old account or authorize its action", async () => {
  let releaseOldCheck;
  let checks = 0;
  const oldCheck = new Promise(resolve => { releaseOldCheck = resolve; });
  const artifact = { snapshotId: "saved-export" };
  useAuthGate.setState({ user: { id: "account-a", name: "Alice" }, phase: "ready", available: true, source: null });
  useExportArtifact.setState({ artifact, publication: { id: "account-a-link", status: "ready" },
    publicationKey: "account-a-key", publicationTitle: "Alice's link" });
  globalThis.fetch = async (_path, init) => {
    if (init.method === "POST") return Response.json({ user: null });
    checks++;
    if (checks === 1) { await oldCheck; return Response.json(accountSession({ id: "account-a", name: "Alice" })); }
    return Response.json(accountSession(null));
  };

  const staleCheck = refreshAccountSession();
  const allowed = requireAccount("share");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(checks, 1);
  await signOutAccount();
  assert.equal(useAuthGate.getState().user, null);
  assert.equal(useExportArtifact.getState().publication, null);
  assert.equal(useExportArtifact.getState().artifact, artifact);
  assert.equal((await refreshAccountSession()).user, null, "a new check must not reuse the old request");
  assert.equal(checks, 2);

  releaseOldCheck();
  assert.equal((await staleCheck).user, null);
  assert.equal(await allowed, false);
  assert.equal(useAuthGate.getState().user, null);
  assert.equal(useAuthGate.getState().source, null);
  assert.equal(useExportArtifact.getState().publication, null);
  resetExportArtifact();
});

test("a session check finishing during logout cannot authorize a queued action", async () => {
  let releaseOldCheck;
  let finishLogout;
  const oldCheck = new Promise(resolve => { releaseOldCheck = resolve; });
  const logout = new Promise(resolve => { finishLogout = resolve; });
  useAuthGate.setState({ user: { id: "account-a", name: "Alice" }, phase: "ready", available: true, source: null });
  useExportArtifact.setState({ publication: { id: "account-a-link", status: "ready" },
    publicationKey: "account-a-key", publicationTitle: "Alice's link" });
  globalThis.fetch = async (_path, init) => {
    if (init.method === "POST") { await logout; return Response.json({ user: null }); }
    await oldCheck;
    return Response.json(accountSession({ id: "account-a", name: "Alice" }));
  };

  const staleCheck = refreshAccountSession();
  const allowed = requireAccount("share");
  await new Promise(resolve => setImmediate(resolve));
  const signingOut = signOutAccount();
  releaseOldCheck();
  assert.equal((await staleCheck).user, null);
  assert.equal(await allowed, false);
  assert.equal(useAuthGate.getState().source, null);
  assert.equal((await refreshAccountSession()).user, null, "checks during logout must not reuse the old identity");
  finishLogout();
  await signingOut;
  assert.equal(useAuthGate.getState().user, null);
  assert.equal(useExportArtifact.getState().publication, null);
  resetExportArtifact();
});

test("a lost logout response verifies whether to clear or retain the account link", async () => {
  let checks = 0;
  let accountIsSignedIn = false;
  useAuthGate.setState({ user: { id: "account-a", name: "Alice" }, phase: "ready", available: true });
  useExportArtifact.setState({ publication: { id: "account-a-link", status: "ready" },
    publicationKey: "account-a-key", publicationTitle: "Alice's link" });
  globalThis.fetch = async (_path, init) => {
    if (init.method === "POST") throw new Error("Logout response lost");
    checks++;
    return Response.json(accountSession(accountIsSignedIn ? { id: "account-a", name: "Alice" } : null));
  };

  await signOutAccount();
  assert.equal(checks, 1);
  assert.equal(useAuthGate.getState().user, null);
  assert.equal(useExportArtifact.getState().publication, null);

  accountIsSignedIn = true;
  useAuthGate.setState({ user: { id: "account-a", name: "Alice" } });
  useExportArtifact.setState({ publication: { id: "account-a-link", status: "ready" },
    publicationKey: "account-a-key", publicationTitle: "Alice's link" });
  await assert.rejects(signOutAccount(), /Logout response lost/);
  assert.equal(checks, 2);
  assert.equal(useAuthGate.getState().user.id, "account-a");
  assert.equal(useExportArtifact.getState().publication.id, "account-a-link");
  resetExportArtifact();
});
