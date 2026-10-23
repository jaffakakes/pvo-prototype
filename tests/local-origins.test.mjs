import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocalOriginPolicy } from "../scripts/dev/local-origins.mjs";
import { createLocalAuthApi } from "../scripts/dev/local-auth.mjs";
import { createLocalProfileApi } from "../scripts/dev/account-profile.mjs";
import { createLocalAssistantApi } from "../scripts/dev/assistant.mjs";
import {
  PROJECT_URL,
  PUBLISHABLE_KEY,
  fixtureKeys,
  token,
  authService,
} from "./supabase-auth.helpers.mjs";

test("loopback aliases require matching host/origin and the configured port", () => {
  const policy = createLocalOriginPolicy(
    "http://127.0.0.1:4399",
    "https://phone.example",
  );
  const request = (host, origin, url = "/api/test", method = "POST") => ({
    url,
    method,
    headers: { host, ...(origin === undefined ? {} : { origin }) },
  });
  for (const host of ["127.0.0.1:4399", "localhost:4399"])
    assert.equal(policy.accepts(request(host, `http://${host}`)), true);
  assert.equal(
    policy.accepts(request("phone.example", "https://phone.example")),
    true,
  );
  for (const req of [
    request("localhost:4398", "http://localhost:4398"),
    request("localhost:4399", "http://127.0.0.1:4399"),
    request("127.0.0.1:4399", "https://phone.example"),
    request("attacker.example", "http://attacker.example"),
    request(
      "localhost:4399",
      "http://localhost:4399",
      "http://attacker.example/api/test",
    ),
    request("localhost:4399", undefined),
    request("localhost:4399", "null"),
  ])
    assert.equal(policy.accepts(req), false);
  assert.equal(
    policy.accepts(request("localhost:4399", undefined, "/api/test", "GET")),
    true,
  );
  const crossSite = request("localhost:4399", "http://localhost:4399");
  crossSite.headers["sec-fetch-site"] = "cross-site";
  assert.equal(policy.accepts(crossSite), false);
  for (const origin of [
    "http://evil.example",
    "https://localhost:4399",
    "http://localhost:4399/",
  ])
    assert.throws(() => createLocalOriginPolicy(origin));
});

test("auth, profiles and assistant work on loopback and the configured phone origin without redirects", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "restyle-origin-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let auth, profile, assistant;
  let forwarded = 0;
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path.startsWith("/api/auth/"))
      void auth.handle(request, response, path);
    else if (path === "/api/account/profile") void profile(request, response);
    else void assistant.handle(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  });
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const publicOrigin = "https://phone.ngrok.test";
  const { pair, jwk } = await fixtureKeys();
  auth = await createLocalAuthApi({
    directory,
    origin,
    publicOrigin,
    supabaseUrl: PROJECT_URL,
    supabasePublishableKey: PUBLISHABLE_KEY,
    fetcher: authService(jwk),
  });
  profile = createLocalProfileApi({
    directory,
    origin,
    publicOrigin,
    userFor: auth.userFor,
  });
  assistant = createLocalAssistantApi({
    origin,
    publicOrigin,
    fetcher: async () => {
      forwarded++;
      return Response.json({ available: true });
    },
  });
  const signed = await token(pair);
  for (const requestOrigin of [
    `http://localhost:${port}`,
    origin,
    publicOrigin,
  ]) {
    const host = new URL(requestOrigin).host;
    const send = (path, options = {}) =>
      new Promise((resolve, reject) => {
        const request = httpRequest(
          origin + path,
          {
            method: options.method || "GET",
            headers: {
              Host: host,
              ...(options.method ? { Origin: requestOrigin } : {}),
              ...options.headers,
            },
          },
          (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.once("error", reject);
            response.once("end", () => {
              const headers = new Headers();
              for (let i = 0; i < response.rawHeaders.length; i += 2)
                headers.append(
                  response.rawHeaders[i],
                  response.rawHeaders[i + 1],
                );
              resolve(
                new Response(Buffer.concat(chunks), {
                  status: response.statusCode,
                  headers,
                }),
              );
            });
          },
        );
        request.once("error", reject);
        request.end(options.body);
      });
    const session = await send("/api/auth/session");
    assert.equal(session.status, 200);
    assert.equal(session.headers.get("location"), null);
    const exchange = await send("/api/auth/supabase/exchange", {
      method: "POST",
      headers: { Authorization: `Bearer ${signed}` },
    });
    assert.equal(exchange.status, 200);
    const cookie = exchange.headers.getSetCookie()[0].split(";", 1)[0];
    const user = (await exchange.json()).user;
    assert.equal(
      (
        await (
          await send("/api/auth/session", { headers: { Cookie: cookie } })
        ).json()
      ).user.id,
      user.id,
    );
    assert.equal(
      (
        await send("/api/account/profile", {
          method: "PUT",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: user.id,
            name: "Local creator",
            photo: null,
          }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await (
          await send("/api/account/profile", { headers: { Cookie: cookie } })
        ).json()
      ).name,
      "Local creator",
    );
    assert.equal((await send("/api/assistant/status")).status, 200);
    assert.equal(
      (
        await send("/api/assistant/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      200,
    );
    for (const path of [
      "/api/auth/logout",
      "/api/assistant/turn",
      "/api/account/profile",
    ]) {
      const before = forwarded;
      assert.equal(
        (
          await send(path, {
            method: path.endsWith("profile") ? "PUT" : "POST",
            headers: {
              Origin: "http://attacker.example",
              Cookie: cookie,
              "Content-Type": "application/json",
            },
            body: "{}",
          })
        ).status,
        403,
      );
      assert.equal(forwarded, before);
    }
    assert.equal(
      (
        await send("/api/auth/logout", {
          method: "POST",
          headers: { Cookie: cookie },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await (
          await send("/api/auth/session", { headers: { Cookie: cookie } })
        ).json()
      ).user,
      null,
    );
  }
});
