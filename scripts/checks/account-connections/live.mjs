import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  taskFixture,
  expectStatus,
  ORIGIN,
} from "../../../tests/assistant-task-server/helpers.mjs";
import { building } from "../../../tests/assistant-task-server/workspace.helpers.mjs";
import { openCredential } from "../../../server/connections/credentials.js";

// Isolated loopback acceptance. The actual product form handles the token; never log request bodies.
const PORT = 5322;
const origin = `http://127.0.0.1:${PORT}`;
const vite = "http://127.0.0.1:5321";
const privateKey = randomBytes(32).toString("hex");
const session = randomBytes(32).toString("hex");
const repository = "jaffakakes/pvo-prototype";
const initialClock = Date.now() + 600000;
const fixture = await taskFixture({
  clock: initialClock,
  connectionKey: privateKey,
  connectionFetch: (request) =>
    fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    }),
});
let task;
try {
  task = await building(fixture);
} catch (error) {
  await fixture.close();
  throw error;
}
task = (
  await fixture.control({
    action: "step",
    id: task.id,
    command: {
      kind: "ask",
      question: {
        id: "github-setup",
        revision: 0,
        prompt: `Connect ${repository} for the isolated read-only acceptance.`,
        choices: ["Continue without this connection"],
        connection: { provider: "github", repository },
        answer: null,
      },
    },
  })
).body;
let report = {
  status: "waiting_for_private_setup",
  repository,
  startedAt: new Date().toISOString(),
  paidResources: false,
  production: false,
};
let verifying = false;
let disposed = false;
const reportPath = "/tmp/restyle-2b-live-report.json";
await writeFile(reportPath, JSON.stringify(report, null, 2));

async function verify(id) {
  if (verifying) return;
  verifying = true;
  report = { ...report, status: "checking" };
  let token = null;
  try {
    const first = (
      await fixture.request("/api/account-connections", {
        headers: { "X-Restyle-Owner": task.ownerId },
      })
    ).body.items.find((item) => item.connection.id === id);
    assert.ok(first);
    const secrets = await fixture.control({ action: "connection-storage" });
    const saved = secrets.body.find((item) => item.id === id);
    const current = (await fixture.request(`/api/assistant/tasks/${task.id}`))
      .body.task;
    assert.equal(current.questions[0].answer.connectionId, id);
    token = await openCredential(
      { ACCOUNT_CONNECTION_KEY: privateKey },
      current.ownerId,
      id,
      saved.revision,
      saved.credential,
    );
    const call = async (kind, body, options = {}) => {
      const owner = options.session
        ? (await fixture.request("/api/auth/session", options)).body.user.id
        : task.ownerId;
      return fixture.request(`/api/account-connections/${kind}`, {
        body,
        ...options,
        headers: { "X-Restyle-Owner": owner },
      });
    };
    const repositoryRead = await call("invoke", {
      id,
      call: { operation: "github_repository_read", input: {} },
    });
    expectStatus(repositoryRead, 200);
    assert.equal(repositoryRead.body.result.repository, repository);
    const issues = await call("invoke", {
      id,
      call: { operation: "github_issues_list", input: { page: 1 } },
    });
    expectStatus(issues, 200);
    expectStatus(
      await call(
        "invoke",
        { id, call: { operation: "github_repository_read", input: {} } },
        { session: fixture.otherCookie },
      ),
      404,
    );
    await fixture.restart();
    assert.equal(
      (await fixture.request(`/api/assistant/tasks/${task.id}`)).body.task
        .questions[0].answer.connectionId,
      id,
    );
    expectStatus(
      await call("check", { id, expectedRevision: first.connection.revision }),
      200,
    );
    let expired = false;
    if (first.expiresAt !== null) {
      expectStatus(
        await fixture.control({ action: "time", now: first.expiresAt + 1 }),
        200,
      );
      const after = (
        await fixture.request("/api/account-connections", {
          headers: { "X-Restyle-Owner": task.ownerId },
        })
      ).body.items.find((item) => item.connection.id === id);
      assert.equal(after.connection.status, "expired");
      assert.equal(
        (await fixture.control({ action: "connection-storage" })).body.find(
          (item) => item.id === id,
        ).credential,
        null,
      );
      expired = true;
      expectStatus(
        await fixture.control({ action: "time", now: initialClock }),
        200,
      );
    }
    const before = (
      await fixture.request("/api/account-connections", {
        headers: { "X-Restyle-Owner": task.ownerId },
      })
    ).body.items.find((item) => item.connection.id === id);
    const reconnect = await call("connect", {
      id,
      expectedRevision: before.connection.revision,
      setup: { provider: "github", repository },
      token,
    });
    expectStatus(reconnect, 200);
    token = null;
    expectStatus(
      await call("disconnect", {
        id,
        expectedRevision: reconnect.body.connection.revision,
      }),
      200,
    );
    assert.equal(
      (await fixture.control({ action: "connection-storage" })).body.find(
        (item) => item.id === id,
      ).credential,
      null,
    );
    expectStatus(
      await call("invoke", {
        id,
        call: { operation: "github_repository_read", input: {} },
      }),
      409,
    );
    const latest = (await fixture.request(`/api/assistant/tasks/${task.id}`))
      .body.task;
    expectStatus(
      await fixture.request(`/api/assistant/tasks/${task.id}/stop`, {
        body: { expectedRevision: latest.revision },
      }),
      200,
    );
    report = {
      ...report,
      status: "passed",
      authenticatedAccount: first.account,
      repositoryIsPrivate: repositoryRead.body.result.private,
      issueSummariesRead: issues.body.result.items.length,
      reload: true,
      sameSavedTask: true,
      expiry: expired
        ? "actual token deadline with advanced isolated clock"
        : "covered by separate controlled lifecycle tests; provider supplied no deadline",
      reconnect: true,
      revokedLocally: true,
      otherCreatorBlocked: true,
      providerTokenDeletion:
        "creator can delete the short-lived token in GitHub settings",
      finishedAt: new Date().toISOString(),
    };
  } catch {
    // Preserve only the next action, never assertion payloads or provider data containing credentials.
    report = {
      ...report,
      status: "needs_review",
      next: "Inspect safe lifecycle state; do not log credential-bearing requests or storage.",
      finishedAt: new Date().toISOString(),
    };
  } finally {
    token = null;
    await fixture.close();
    disposed = true;
    report.localStorageRemoved = true;
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}
const entry = await (await fetch(`${vite}/src/main.tsx`)).text();
const reactModule = entry.match(/from "([^"]+\/react\.js\?[^"]+)"/)[1];
const domModule = entry.match(/from "([^"]+\/react-dom_client\.js\?[^"]+)"/)[1];
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Restyle private connection test</title><style>body{margin:0;background:#f4f0eb;color:#211d23;font:15px system-ui}main{max-width:620px;margin:32px auto;padding:20px}h1{font-size:25px}#root{--text:#211d23;--input:#ece7e1;--q14:#cdc6c0;--accent:#ac0057}button,input{font:inherit}</style></head><body><main><h1>Restyle private connection test</h1><p>This isolated test reads repository details and issues. After you connect, it checks reload, expiry, reconnect and disconnect, then deletes its local storage. It makes no GitHub changes and does not publish Restyle.</p><p>Create a short-lived fine-grained token for <strong>${repository}</strong> with Issues read permission. Keep the token in the private field below. You can delete it in GitHub settings after the test.</p><div id="root"></div><p id="result" role="status"></p></main><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/@vite/client"></script><script type="module">import React from ${JSON.stringify(reactModule)};import ReactDOM from ${JSON.stringify(domModule)};const{createRoot}=ReactDOM;import{ConnectionsPanel}from'/src/features/account-connections/ConnectionsPanel.tsx';import{refreshAccountSession}from'/src/state/auth/authGateStore.ts';await refreshAccountSession();const task=await(await fetch('/acceptance/task')).json();const root=createRoot(document.getElementById('root'));root.render(React.createElement(ConnectionsPanel,{taskSetup:{task,question:task.questions[0],updated(){document.getElementById('result').textContent='Running the isolated checks. The saved key will be removed afterward.';root.unmount()},decline(){root.unmount();document.getElementById('result').textContent='No account was connected.'}}}));const poll=setInterval(async()=>{const value=await(await fetch('/acceptance/status')).json();if(['passed','needs_review'].includes(value.status)){clearInterval(poll);document.getElementById('result').textContent=value.status==='passed'?'Checks passed. Restyle’s test key and local storage are removed. You can delete the token in GitHub settings.':'The check needs review. The local key and storage have been removed.';}},1500);</script></body></html>`;
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${PORT}`) {
      res.writeHead(403);
      res.end();
      return;
    }
    const url = new URL(req.url, origin);
    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cache-Control": "no-store",
        "Set-Cookie": `restyle-proof=${session}; HttpOnly; SameSite=Strict; Path=/`,
        "Referrer-Policy": "no-referrer",
      });
      res.end(html);
      return;
    }
    if (!req.headers.cookie?.split("; ").includes(`restyle-proof=${session}`)) {
      res.writeHead(401);
      res.end();
      return;
    }
    if (url.pathname.startsWith("/acceptance/") && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify(url.pathname === "/acceptance/task" ? task : report),
      );
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      if (disposed) {
        res.writeHead(410);
        res.end("{}");
        return;
      }
      if (req.method !== "GET" && req.headers.origin !== origin) {
        res.writeHead(403);
        res.end();
        return;
      }
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 4096) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      const result = await fixture.request(url.pathname + url.search, {
        method: req.method,
        body: raw ? JSON.parse(raw) : undefined,
        headers: {
          Origin: ORIGIN,
          "X-Restyle-Owner": req.headers["x-restyle-owner"] ?? "",
        },
      });
      raw = "";
      res.writeHead(result.status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(result.body));
      if (
        url.pathname === "/api/account-connections/attach" &&
        result.status === 200
      )
        void verify(result.body.task.questions[0].answer.connectionId);
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    const upstream = await fetch(vite + url.pathname + url.search);
    res.writeHead(upstream.status, {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    if (!res.headersSent)
      res.writeHead(503, { "Content-Type": "application/json" });
    res.end('{"error":"The isolated connection test could not respond."}');
  }
});
server.on("upgrade", (req, socket, head) => {
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: 5321,
    path: req.url,
    headers: { ...req.headers, host: "127.0.0.1:5321" },
  });
  upstream.on("upgrade", (response, target, received) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\r\n")}\r\n\r\n`,
    );
    if (head.length) target.write(head);
    if (received.length) socket.write(received);
    target.pipe(socket).pipe(target);
    socket.on("error", () => target.destroy());
    target.on("error", () => socket.destroy());
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});
server.listen(PORT, "127.0.0.1", () =>
  console.log(
    JSON.stringify({ url: origin, status: "private_form_ready", reportPath }),
  ),
);
async function close() {
  server.closeAllConnections();
  server.close();
  if (!disposed) await fixture.close();
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
setTimeout(close, 8 * 3600000);
