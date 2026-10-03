import { sourceModules } from "../helpers/source-assets.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

// Prerequisites: `npm run build:language` and Chrome (or CHROME_PATH).
const paths = [
  ["/language/result.js", new URL("../../../packages/pvo-language/result.js", import.meta.url), "text/javascript"],
  [
    "/language/index.js",
    new URL("../../../packages/pvo-language/index.js", import.meta.url),
    "text/javascript",
  ],
  [
    "/language/pkg/pvo_language.js",
    new URL(
      "../../../packages/pvo-language/pkg/pvo_language.js",
      import.meta.url,
    ),
    "text/javascript",
  ],
  [
    "/language/pkg/pvo_language_bg.wasm",
    new URL(
      "../../../packages/pvo-language/pkg/pvo_language_bg.wasm",
      import.meta.url,
    ),
    "application/wasm",
  ],
  [
    "/runtime.js",
    new URL("../../../packages/pvo-code-runtime/index.js", import.meta.url),
    "text/javascript",
  ],
  [
    "/form-feedback.js",
    new URL(
      "../../../packages/pvo-code-runtime/form-feedback.js",
      import.meta.url,
    ),
    "text/javascript",
  ],
];

let assets;
try {
  assets = new Map(
    await Promise.all(
      paths.map(async ([route, path, type]) => [
        route,
        { body: await readFile(path), type },
      ]),
    ),
  );
} catch (error) {
  throw new Error(
    `PVO language browser check needs generated WASM. Run npm run build:language first. ${error.message}`,
  );
}

for (const [route, asset] of await sourceModules(
  new URL("../../../packages/pvo-code-runtime/", import.meta.url),
  "",
))
  assets.set(route, asset);

for (const [path, asset] of await sourceModules(new URL("../../../packages/pvo-fonts/", import.meta.url), "/pvo-fonts")) assets.set(path, asset);

const server = createServer((request, response) => {
  const route = new URL(request.url ?? "/", "http://localhost").pathname;
  const asset = assets.get(route);
  if (asset) {
    response.writeHead(200, {
      "content-type": asset.type,
      "content-length": asset.body.length,
      "cache-control": "no-store",
    });
    response.end(asset.body);
    return;
  }
  if (route !== "/") {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(
    "<!doctype html><title>PVO language test</title><main id='host'></main>",
  );
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);

  const result = await page.evaluate(async (origin) => {
    const { compilePvoComponent, PvoLanguageError } = await import(
      `${origin}/language/index.js`
    );
    const { mountCustomComponent } = await import(`${origin}/runtime.js`);
    const valid = {
      tooltip: {
        structure: "<tooltip><text>Read this</text></tooltip>",
        style: "tooltip { color: #111; }",
        logic: "",
      },
      card: {
        structure:
          '<card><title>Continue?</title><body>Open the next part</body><button id="next">Next</button></card>',
        style: "button { background: #FF2D78; }",
        logic: "on press(next) { continue(); }",
      },
      choice: {
        structure:
          '<choice><prompt>Choose one</prompt><option id="first">First</option><option id="second">Second</option></choice>',
        style: "option { color: #111; }",
        logic:
          'on choose(first) { go_to_scene("branch"); } on choose(second) { continue(); }',
      },
      form: {
        structure:
          '<form><field name="visitor" kind="name"/><submit>Send</submit></form>',
        style: "form { color: #F2F0E9; }",
        logic: "on submit { continue(); }",
      },
    };
    const compiled = {};
    for (const [kind, source] of Object.entries(valid)) {
      compiled[kind] = await compilePvoComponent(kind, source);
    }
    const apostrophe = await compilePvoComponent("tooltip", {
      structure: "<tooltip><text>It&#39;s ready</text></tooltip>",
      style: "",
      logic: "",
    });
    const requestChoice = await compilePvoComponent("choice", {
      ...valid.choice,
      logic:
        'on choose(first) { request({"url":"https://example.com/collect","method":"POST","body":"{\\"picked\\":1}","onSuccess":{"kind":"continue"},"onError":null}); } on choose(second) { continue(); }',
    });
    window.__compiledForm = await compilePvoComponent("form", {
      structure:
        '<form><heading>Reserve a place</heading><field name="seats" kind="number" label="How many seats?"/><submit waiting="Reserving…">Reserve</submit></form>',
      style: "heading { color: #FFD23E; }",
      logic: "on submit { continue(); }",
    });

    async function rejection(kind, source) {
      try {
        await compilePvoComponent(kind, source);
        return null;
      } catch (error) {
        if (!(error instanceof PvoLanguageError)) throw error;
        return { part: error.part, code: error.diagnostic.code };
      }
    }

    const rejected = {
      tooltipButton: await rejection("tooltip", {
        ...valid.tooltip,
        structure:
          '<tooltip><text>Read</text><button id="go">Go</button></tooltip>',
      }),
      tooltipOnclick: await rejection("tooltip", {
        ...valid.tooltip,
        structure:
          '<tooltip><text onclick="pvo.resume()">Read</text></tooltip>',
      }),
      style: await rejection("choice", {
        ...valid.choice,
        style: "option { background-image: url(https://example.com/x.png); }",
      }),
      logic: await rejection("choice", {
        ...valid.choice,
        logic:
          "on choose(first) { submit(fields); } on choose(second) { continue(); }",
      }),
    };

    window.__actions = [];
    window.__runtimeErrors = [];
    window.__handle = mountCustomComponent(document.getElementById("host"), {
      componentId: "browser-choice",
      ...compiled.choice,
      onAction: (action) => window.__actions.push(action),
      onError: (error) => window.__runtimeErrors.push(error),
    });
    return {
      kinds: Object.fromEntries(
        Object.entries(compiled).map(([kind, item]) => [
          kind,
          item.structure.type,
        ]),
      ),
      choiceHtml: compiled.choice.html,
      choiceJs: compiled.choice.js,
      apostropheText: apostrophe.structure.text,
      requestAction: requestChoice.rules[0].action,
      rejected,
    };
  }, origin);

  assert.deepEqual(result.kinds, {
    tooltip: "tooltip",
    card: "card",
    choice: "choice",
    form: "form",
  });
  assert.equal(
    result.choiceJs,
    "",
    "compiled Logic must not become arbitrary JavaScript",
  );
  assert.equal(result.apostropheText, "It's ready");
  assert.match(result.choiceHtml, /onclick="pvo\.pick\(0\)"/);
  assert.deepEqual(result.requestAction, {
    kind: "request",
    url: "https://example.com/collect",
    method: "POST",
    body: '{"picked":1}',
    onSuccess: { kind: "continue" },
    onError: null,
  });
  assert.deepEqual(result.rejected, {
    tooltipButton: { part: "structure", code: "invalid_child" },
    tooltipOnclick: { part: "structure", code: "invalid_attribute" },
    style: { part: "style", code: "invalid_style" },
    logic: { part: "logic", code: "action_not_allowed" },
  });

  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe[sandbox="allow-same-origin"]');
    return frame?.contentDocument?.querySelectorAll("button").length === 2;
  });
  // The renderer iframe can paint before its separate action Worker is ready.
  await page.waitForTimeout(400);
  assert.deepEqual(
    await page.evaluate(() => window.__actions),
    [],
    "compiling must not fire an action",
  );
  await page.evaluate(() => {
    const frame = document.querySelector('iframe[sandbox="allow-same-origin"]');
    frame.contentDocument.querySelector("button").click();
  });
  try {
    await page.waitForFunction(() => window.__actions.length === 1, null, {
      timeout: 4000,
    });
  } catch {
    const state = await page.evaluate(() => ({
      actions: window.__actions,
      errors: window.__runtimeErrors,
    }));
    throw new Error(`Compiled Choice did not route: ${JSON.stringify(state)}`);
  }
  await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => window.__actions), [
    { method: "pick", args: [0] },
  ]);
  assert.deepEqual(await page.evaluate(() => window.__runtimeErrors), []);
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.__handle.destroy());
  assert.equal(await page.locator("iframe").count(), 0);
  await page.evaluate(async (origin) => {
    const { mountCustomComponent } = await import(`${origin}/runtime.js`);
    window.__actions = [];
    window.__handle = mountCustomComponent(document.getElementById("host"), {
      ...window.__compiledForm,
      onAction: (action) => window.__actions.push(action),
      onError: (error) => window.__runtimeErrors.push(error),
    });
  }, origin);
  await page.waitForFunction(() =>
    document
      .querySelector('iframe[sandbox="allow-same-origin"]')
      ?.contentDocument?.querySelector('input[type="number"]'),
  );
  await page.waitForTimeout(400);
  const formView = await page.evaluate(() => {
    const doc = document.querySelector(
      'iframe[sandbox="allow-same-origin"]',
    ).contentDocument;
    const input = doc.querySelector("input"),
      button = doc.querySelector("button");
    window.__handle.setPending(true);
    const pending = {
      label: button.textContent,
      disabled: input.disabled && button.disabled,
    };
    window.__handle.setPending(false);
    input.value = "2.5";
    const result = {
      pending,
      heading: doc.querySelector("h3").textContent,
      label: input.getAttribute("aria-label"),
      step: input.step,
      restoredLabel: button.textContent,
      valid: input.checkValidity(),
    };
    button.click();
    return result;
  });
  assert.deepEqual(formView, {
    pending: { label: "Reserving…", disabled: true },
    heading: "Reserve a place",
    label: "How many seats?",
    step: "any",
    restoredLabel: "Reserve",
    valid: true,
  });
  await page.waitForFunction(() => window.__actions.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__actions), [
    { method: "submit", args: [{ seats: "2.5" }] },
  ]);
  assert.deepEqual(await page.evaluate(() => window.__runtimeErrors), []);
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.__handle.destroy());
  console.log(
    "PVO language browser check passed: Rust/WASM contracts, rejection, sandbox Choice action and labelled numeric Form with pending feedback.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
