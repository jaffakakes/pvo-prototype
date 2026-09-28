import assert from "node:assert/strict";
import { createServer } from "node:http";
import { sourceModules } from "../helpers/source-assets.mjs";
import { chromium } from "playwright-core";

// Internal renderer isolation regression; this is not a creator-facing JavaScript authoring route.
const runtimeAssets = new Map(
  await sourceModules(
    new URL("../../../packages/pvo-code-runtime/", import.meta.url),
    "",
  ),
);
runtimeAssets.set("/runtime.js", runtimeAssets.get("/index.js"));
const leaks = [];
const hostRequests = [];
const server = createServer((request, response) => {
  if (request.url?.startsWith("/leak")) {
    leaks.push(request.url);
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("leaked");
  } else if (runtimeAssets.has(request.url)) {
    const asset = runtimeAssets.get(request.url);
    response.writeHead(200, {
      "content-type": asset.type,
      "cache-control": "no-store",
    });
    response.end(asset.body);
  } else if (request.url === "/api") {
    hostRequests.push(request.url);
    response.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    response.end(JSON.stringify({ value: "from host" }));
  } else {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      "<!doctype html><title>PVO runtime test</title><main id='host'></main>",
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage();
const failures = [];
page.on("pageerror", (error) => failures.push(error.message));

try {
  await page.goto(origin);
  await page.evaluate(async (origin) => {
    const { mountCustomComponent } = await import(`${origin}/runtime.js`);
    window.__actions = [];
    window.__errors = [];
    window.__handle = mountCustomComponent(document.getElementById("host"), {
      componentId: "test-component",
      html: `<div class="safe">{{prompt}}</div><button onclick="onPick('street')">Street</button><form onsubmit="pvo.submit(fields)"><input name="alias" value="Ada"><button type="submit">Send</button></form><img src="${origin}/leak?img"><a href="${origin}/leak?nav">link</a><script>parent.__breached=true</script><iframe src="${origin}/leak?frame"></iframe>`,
      css: `.safe{color:#A78BFA;background-image:url(${origin}/leak?css)}`,
      js: `pvo.pick("startup"); fetch("${origin}/leak?fetch").catch(()=>{}); function onPick(value){ pvo.pick(value); }`,
      fields: { prompt: "Pick <one>" },
      onAction: (action) => window.__actions.push(action),
      onError: (error) => window.__errors.push(error),
    });
  }, origin);
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe[sandbox="allow-same-origin"]');
    return frame?.contentDocument?.querySelector("button");
  });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => {
    const frame = document.querySelector('iframe[sandbox="allow-same-origin"]');
    const doc = frame.contentDocument;
    return {
      text: doc.querySelector("#pvo-root").textContent,
      forbidden: doc.querySelectorAll("img,a,script,iframe").length,
      onclick: doc.querySelector("button").getAttribute("onclick"),
      actions: window.__actions.slice(),
      width: frame.getBoundingClientRect().width,
      height: frame.getBoundingClientRect().height,
    };
  });
  assert.match(before.text, /Pick <one>/);
  assert.equal(before.forbidden, 0);
  assert.equal(before.onclick, null);
  assert.deepEqual(
    before.actions,
    [],
    "top-level pvo.pick must not auto-route",
  );
  assert.ok(before.width > 0 && before.height > 0, "renderer should auto-size");
  await page.evaluate(() => {
    const doc = document.querySelector(
      'iframe[sandbox="allow-same-origin"]',
    ).contentDocument;
    doc.querySelector("button").click();
    doc.querySelector("form button").click();
  });
  try {
    await page.waitForFunction(() => window.__actions.length === 2, null, {
      timeout: 4000,
    });
  } catch {
    throw new Error(
      `Actions missing: ${JSON.stringify(await page.evaluate(() => ({ errors: window.__errors, actions: window.__actions })))}`,
    );
  }
  const actions = await page.evaluate(() => window.__actions);
  assert.deepEqual(actions, [
    { method: "pick", args: ["street"] },
    { method: "submit", args: [{ alias: "Ada" }] },
  ]);
  assert.equal(await page.evaluate(() => window.__breached), undefined);
  assert.deepEqual(
    leaks,
    [],
    "custom markup, CSS and Functions must not reach the network",
  );

  await page.evaluate(() =>
    window.__handle.update({
      html: '<button onclick="pvo.resume()">Done</button>',
      css: "button{color:#FF2D78}",
      js: "",
    }),
  );
  await page.waitForTimeout(250);
  await page.evaluate(() =>
    document
      .querySelector('iframe[sandbox="allow-same-origin"]')
      .contentDocument.querySelector("button")
      .click(),
  );
  await page.waitForFunction(() => window.__actions.length === 3);
  assert.deepEqual((await page.evaluate(() => window.__actions))[2], {
    method: "resume",
    args: [],
  });

  await page.evaluate(() =>
    window.__handle.update({
      html: '<button onclick="probe()">Check isolation</button>',
      js: 'function probe() { let database = "unavailable"; try { indexedDB.open("probe"); database = "opened"; } catch (error) { database = error.name; } pvo.track("isolation", { parent: typeof parent, document: typeof document, storage: typeof localStorage, database }); }',
    }),
  );
  await page.waitForTimeout(250);
  await page.evaluate(() =>
    document
      .querySelector('iframe[sandbox="allow-same-origin"]')
      .contentDocument.querySelector("button")
      .click(),
  );
  await page.waitForFunction(() => window.__actions.length === 4);
  const isolation = (await page.evaluate(() => window.__actions))[3];
  assert.equal(isolation.method, "track");
  assert.equal(isolation.args[1].parent, "undefined");
  assert.equal(isolation.args[1].document, "undefined");
  assert.equal(isolation.args[1].storage, "undefined");
  assert.notEqual(isolation.args[1].database, "opened");

  await page.evaluate(
    (origin) =>
      window.__handle.update({
        html: '<button onclick="loadData()">Load</button><button onclick="denyData()">Deny</button><button onclick="fireAndForget()">Later</button>',
        js: `pvo.request({url:"${origin}/api"}).catch(()=>{}); async function loadData() { const data = await pvo.request({url:"${origin}/api"}); pvo.track("response", data.value); } async function denyData() { try { await pvo.request({url:"https://blocked.example/api"}); } catch (error) { pvo.track("rejected", error.message); } } function fireAndForget() { pvo.request({url:"${origin}/api"}).then(data => pvo.track("later", data.value)); }`,
        onAction: (action) => {
          if (action.method === "request") {
            const url = action.args[0]?.url;
            if (url !== `${origin}/api`)
              throw new Error("Domain not allowed by host");
            return fetch(url).then((response) => response.json());
          }
          window.__actions.push(action);
        },
      }),
    origin,
  );
  await page.waitForTimeout(250);
  assert.deepEqual(
    hostRequests,
    [],
    "top-level pvo.request must not contact the host",
  );
  await page.evaluate(() =>
    document
      .querySelector('iframe[sandbox="allow-same-origin"]')
      .contentDocument.querySelector("button")
      .click(),
  );
  await page.waitForFunction(() =>
    window.__actions.some((action) => action.args?.[0] === "response"),
  );
  assert.equal(
    (await page.evaluate(() => window.__actions.at(-1))).args[1],
    "from host",
  );
  assert.deepEqual(
    hostRequests,
    ["/api"],
    "only the validated host should send the request",
  );
  await page.evaluate(() =>
    document
      .querySelector('iframe[sandbox="allow-same-origin"]')
      .contentDocument.querySelectorAll("button")[1]
      .click(),
  );
  await page.waitForFunction(() =>
    window.__actions.some((action) => action.args?.[0] === "rejected"),
  );
  assert.match(
    (await page.evaluate(() => window.__actions.at(-1))).args[1],
    /Domain not allowed/,
  );
  assert.deepEqual(hostRequests, ["/api"]);
  await page.evaluate(() =>
    document
      .querySelector('iframe[sandbox="allow-same-origin"]')
      .contentDocument.querySelectorAll("button")[2]
      .click(),
  );
  await page.waitForFunction(() =>
    window.__actions.some((action) => action.args?.[0] === "later"),
  );
  assert.equal(
    (await page.evaluate(() => window.__actions.at(-1))).args[1],
    "from host",
    "a request callback should still run when the handler does not return its Promise",
  );
  assert.deepEqual(hostRequests, ["/api", "/api"]);

  await page.evaluate(() => window.__handle.update({ js: "while(true){}" }));
  await page.waitForFunction(
    () =>
      window.__errors.some((error) =>
        error.includes("did not start and were stopped"),
      ),
    { timeout: 5000 },
  );
  assert.equal(
    await page.evaluate(() => document.readyState),
    "complete",
    "hung custom code must not freeze the host",
  );
  await page.evaluate(() => window.__handle.destroy());
  assert.equal(
    await page.locator("iframe").count(),
    0,
    "destroy should remove both sandboxes",
  );
  assert.deepEqual(leaks, []);
  assert.deepEqual(failures, []);
  console.log(
    "PVO code runtime security check passed: inert markup, scoped CSS, opaque Worker, gated pvo actions, host-mediated requests, network/storage isolation, worker watchdog, cleanup.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
