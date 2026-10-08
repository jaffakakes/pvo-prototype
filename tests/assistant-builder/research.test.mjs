import assert from "node:assert/strict";
import test from "node:test";
import { publicResearch } from "../../server/assistant/builder/researchProvider.js";
import {
  parseBuilderResearch,
  parseBuilderResearchResult,
  parseBuilderDecision,
  builderDecisionSchema,
  builderResearchDefinitions,
  BUILDER_RESEARCH_KINDS,
  newBuilderState,
  acceptBuilderDecision,
  beginBuilderBatch,
  nextBuilderTool,
  recordBuilderTool,
  builderStage,
} from "../../packages/pvo-assistant/builder/index.js";
const signal = () => new AbortController().signal;
const dns = (url) => new URL(url).hostname === "dns.google";
const answer = () =>
  Response.json({ Status: 0, Answer: [{ type: 1, data: "8.8.8.8" }] });

test("public research can precede the agreement but cannot generate source, run commands or change permissions", () => {
  const tool = {
    kind: "web_read",
    url: "https://docs.cloudflare.com/containers/",
  };
  const decision = { kind: "research", calls: [tool] };
  assert.deepEqual(
    parseBuilderDecision(decision, {
      hasAgreement: false,
      available: BUILDER_RESEARCH_KINDS,
    }),
    decision,
  );
  for (const value of [
    { ...tool, headers: { Authorization: "secret" } },
    { ...tool, url: "file:///etc/passwd" },
    { ...tool, url: "https://user:pass@public.com/" },
    { kind: "web_search", query: "x".repeat(201) },
  ])
    assert.throws(() => parseBuilderResearch(value));
  assert.throws(() =>
    parseBuilderDecision(
      { kind: "research", calls: [{ kind: "workspace_list" }] },
      { hasAgreement: false, available: BUILDER_RESEARCH_KINDS },
    ),
  );
  assert.throws(() =>
    parseBuilderDecision(decision, { hasAgreement: false, available: [] }),
  );
  const schema = builderDecisionSchema(
    false,
    builderResearchDefinitions(BUILDER_RESEARCH_KINDS),
  );
  assert.deepEqual(
    schema.anyOf.map((item) => item.properties.kind.const),
    ["ask", "agreement", "manual_alternative", "ask_research", "research"],
  );
  let state = beginBuilderBatch(
    acceptBuilderDecision(newBuilderState(), decision),
    3,
  );
  state = recordBuilderTool(
    state,
    nextBuilderTool(state),
    { kind: "web_read", status: "unavailable", result: null },
    true,
  );
  assert.equal(builderStage(state), "model");
  assert.equal(state.agreement, null);
  assert.equal(state.feedback.length, 1);
});

test("research adapter reads only public HTTPS, omits credentials and saves bounded cited text", async () => {
  const calls = [];
  const provider = publicResearch({
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (dns(url)) return answer();
      return new Response(
        "<html><title>Public docs</title><main>" +
          "🙂".repeat(7000) +
          '<a href="https://docs.cloudflare.com/next">Next</a></main></html>',
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  const tool = {
    kind: "web_read",
    url: "https://docs.cloudflare.com/containers/",
  };
  const result = await provider.execute(tool, signal());
  assert.equal(result.status, "completed");
  assert.equal(result.result.title, "Public docs");
  assert.equal(result.result.url, tool.url);
  assert.equal(new TextEncoder().encode(result.result.text).length, 16000);
  assert.equal(result.result.truncated, true);
  assert.equal(result.result.links.length, 1);
  assert.equal(calls.length, 3);
  for (const { init } of calls) {
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "manual");
    assert.ok(!Object.hasOwn(init.headers, "Authorization"));
    assert.ok(!Object.hasOwn(init.headers, "Cookie"));
  }
  assert.throws(() =>
    parseBuilderResearchResult(tool, { ...result, ownerId: "foreign" }),
  );
  assert.throws(() =>
    parseBuilderResearchResult(tool, { ...result, status: "unknown" }),
  );
});

test("unsafe addresses, private DNS and redirects fail without evidence or credential forwarding", async () => {
  for (const mode of ["private-url", "private-dns", "redirect"]) {
    const calls = [];
    const provider = publicResearch({
      fetch: async (url) => {
        calls.push(String(url));
        if (dns(url))
          return mode === "private-dns"
            ? Response.json({
                Status: 0,
                Answer: [{ type: 1, data: "127.0.0.1" }],
              })
            : answer();
        return new Response(null, {
          status: 302,
          headers: { Location: "https://127.0.0.1/admin" },
        });
      },
    });
    const result = await provider.execute(
      {
        kind: "web_read",
        url:
          mode === "private-url"
            ? "https://metadata.internal/"
            : "https://public.com/",
      },
      signal(),
    );
    assert.deepEqual(result, {
      kind: "web_read",
      status: "unavailable",
      result: null,
    });
    assert.equal(
      calls.filter((url) => !dns(url)).length,
      mode === "redirect" ? 1 : 0,
    );
  }
  assert.equal(publicResearch({ fetch: null }), null);
});

test("public search preserves actual query and citations; challenges and aborts never become invented success", async () => {
  const calls = [];
  const provider = publicResearch({
    fetch: async (url, init) => {
      calls.push(String(url));
      if (dns(url)) return answer();
      assert.equal(init.method, "GET");
      return new Response(
        '<a class="result__a" href="https://docs.cloudflare.com/containers/">Containers</a><a class="result__snippet">Public documentation</a>',
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  const result = await provider.execute(
    { kind: "web_search", query: "Cloudflare Containers documentation" },
    signal(),
  );
  assert.equal(result.status, "completed");
  assert.equal(
    result.result.results[0].url,
    "https://docs.cloudflare.com/containers/",
  );
  assert.equal(
    new URL(calls.at(-1)).searchParams.get("q"),
    result.result.query,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    provider.execute(
      { kind: "web_search", query: "ignored" },
      controller.signal,
    ),
  );
});
