import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBuilderResearch,
  parseBuilderResearchResult,
  serializeBuilderResearch,
  createResearchEvidence,
  builderResearchDefinitions,
} from "../../packages/pvo-assistant/builder/index.js";
import { planSavedBuild } from "../../server/assistant/builder/planner.js";
import { publicResearch } from "../../server/assistant/builder/researchProvider.js";
import { batchProgressEvidence } from "../../server/assistant/tasks/progressEvidence.js";
import { claim, create } from "../assistant-tasks/fixtures.mjs";
import { evidencePage, evidenceNote } from "./research-evidence.fixture.mjs";

test("structured research records the requested operation and actual source without certifying access", () => {
  for (const operation of [
    "Show free calendar times",
    "Send an equipment request to a work tracker",
    "Compare tide times at two beaches",
  ]) {
    const tool = evidenceNote({ operation });
    const result = createResearchEvidence(tool, evidencePage);
    assert.equal(result.assessment.operation, operation);
    assert.equal(result.source.checkedAt, evidencePage.retrievedAt);
    assert.equal(result.source.url, evidencePage.url);
    assert.equal(result.verification, "source_text_only");
    assert.deepEqual(
      parseBuilderResearchResult(tool, {
        kind: tool.kind,
        status: "completed",
        result,
      }).result,
      result,
    );
  }
  const reordered = Object.fromEntries(
    Object.entries(evidenceNote()).reverse(),
  );
  assert.equal(
    serializeBuilderResearch(reordered),
    serializeBuilderResearch(evidenceNote()),
  );
});

test("research rejects invented quotations, authority fields, missing verification work and excessive content", () => {
  assert.throws(
    () =>
      createResearchEvidence(
        evidenceNote({ excerpts: ["This account is already authorized."] }),
        evidencePage,
      ),
    /saved page text/,
  );
  for (const extra of [
    { sourceUrl: "https://invented.example/" },
    { checkedAt: "2026-10-09" },
    { ownerId: "someone" },
    { permissions: ["calendar.read"] },
    { verification: "passed" },
    { sourceOperationId: "../other" },
    { excerpts: [] },
    { stillNeedsTesting: [] },
    { support: "available" },
    { accessRequirements: ["🙂".repeat(151)] },
    { uncertainty: Array(7).fill("unknown") },
    { support: "unclear", uncertainty: [] },
  ])
    assert.throws(() => parseBuilderResearch(evidenceNote(extra)));
  const tool = evidenceNote();
  const result = createResearchEvidence(tool, evidencePage);
  for (const altered of [
    { ...result, verification: "tested" },
    { ...result, source: { ...result.source, operationId: "another" } },
    {
      ...result,
      assessment: { ...result.assessment, operation: "Changed request" },
    },
  ])
    assert.throws(() =>
      parseBuilderResearchResult(tool, {
        kind: tool.kind,
        status: "completed",
        result: altered,
      }),
    );
});

test("missing documentation remains uncertain and truncated source keeps its original limits", () => {
  const tool = evidenceNote({
    support: "not_documented",
    excerpts: [],
    uncertainty: ["This excerpt does not describe ticket creation."],
  });
  const result = createResearchEvidence(tool, {
    ...evidencePage,
    truncated: true,
  });
  assert.equal(result.source.truncated, true);
  assert.equal(result.assessment.support, "not_documented");
  assert.equal(result.verification, "source_text_only");
  assert.doesNotThrow(() =>
    createResearchEvidence(
      evidenceNote({ excerpts: ["Read free/busy\nintervals for a calendar."] }),
      evidencePage,
    ),
  );
});

test("the planner can request evidence before an agreement while network adapters cannot manufacture it", async () => {
  const decision = { kind: "research", calls: [evidenceNote()] };
  let sent;
  const result = await planSavedBuild(
    claim(create()),
    { agreement: null, feedback: [] },
    builderResearchDefinitions(["web_evidence"]),
    {},
    new AbortController().signal,
    null,
    {
      generate: async (input) => {
        sent = input;
        return { content: decision };
      },
    },
  );
  assert.deepEqual(result, decision);
  assert.match(JSON.stringify(sent), /source_text_only/);
  assert.match(JSON.stringify(sent), /sourceOperationId/);
  let calls = 0;
  const provider = publicResearch({
    fetch: async () => {
      calls++;
      throw new Error("No network expected");
    },
  });
  assert.ok(!provider.definitions.some((tool) => tool.kind === "web_evidence"));
  await assert.rejects(provider.execute(evidenceNote()), /source journal/);
  assert.equal(calls, 0);
});

test("rewriting a research interpretation or changing receipt times cannot fake new external evidence", () => {
  const progress = (tool, page) =>
    batchProgressEvidence({
      round: 1,
      batchEnd: "completed",
      agreement: null,
      decision: { kind: "research", calls: [tool] },
      feedback: [
        {
          operationId: "build-1-0",
          result: {
            kind: tool.kind,
            status: "completed",
            result: createResearchEvidence(tool, page),
          },
        },
      ],
    });
  assert.deepEqual(
    progress(evidenceNote(), evidencePage),
    progress(
      evidenceNote({
        sourceOperationId: "new-receipt",
        operation: "Reworded operation",
        uncertainty: ["Reworded uncertainty"],
      }),
      { ...evidencePage, retrievedAt: "2026-10-09T10:00:00.000Z" },
    ),
  );
  assert.notDeepEqual(
    progress(evidenceNote(), evidencePage),
    progress(evidenceNote(), {
      ...evidencePage,
      url: "https://calendar.example.com/docs/another",
    }),
  );
});
