import assert from "node:assert/strict";
import test from "node:test";
import { createOllamaAssistantFetch } from "../scripts/dev/ollama/assistant.mjs";
import { localOllamaModels } from "../scripts/dev/ollama/models.mjs";
import { localEditingMessages } from "../scripts/dev/ollama/prompt.mjs";

const signal = () => new AbortController().signal;
const project = () => ({
  mode: "plan",
  prompt: "Add the title Hello from 2 to 5 seconds.",
  history: [],
  observations: [],
  project: {
    selection: { clipId: null, textId: null, componentId: null, audioId: null },
    fingerprint: "local-test",
    currentSceneId: "main",
    playhead: 0,
    ratio: "9:16",
    canvas: { width: 1080, height: 1920 },
    scenes: [
      {
        id: "main",
        name: "Main",
        parent: null,
        duration: 10,
        muted: false,
        musicGain: 1,
        clipGain: 1,
        clips: [
          {
            id: 1,
            start: 0,
            end: 10,
            sourceIn: 0,
            sourceOut: 10,
            sourceDuration: 10,
            speed: 1,
            zoom: 1,
            mirror: false,
            fit: "cover",
            hasMedia: true,
            audioDetached: false,
          },
        ],
        texts: [],
        audioClips: [],
        components: [],
      },
    ],
  },
});
const draft = {
  message: "Adding Hello.",
  observations: [],
  operations: [
    { kind: "text.add", sceneId: "main", text: "Hello", start: 2, end: 5 },
  ],
};
const reply = (content) =>
  Response.json({
    done: true,
    done_reason: "stop",
    message: { role: "assistant", content },
  });

test("local follow-ups focus on the current content of components created in this request", () => {
  const messages = [
    { role: "system", content: "Preserve native policies." },
    { role: "user", content: "Complete the current request." },
  ];
  const request = {
    execution: {
      receipts: [
        {
          changes: [
            {
              before: null,
              after: {
                kind: "component",
                sceneId: "main",
                values: { id: "new-note", content: { text: "Old starter" } },
              },
            },
          ],
        },
      ],
    },
    project: {
      scenes: [
        {
          id: "main",
          components: [
            {
              id: "new-note",
              type: "tooltip",
              content: { text: "Current wording" },
            },
            {
              id: "existing-note",
              type: "tooltip",
              content: { text: "Unrelated content" },
            },
          ],
        },
        {
          id: "another-scene",
          components: [
            {
              id: "new-note",
              type: "tooltip",
              content: { text: "Different scene" },
            },
          ],
        },
      ],
    },
  };
  const focused = localEditingMessages(messages, request);
  assert.equal(
    focused[0],
    messages[0],
    "The native system policies remain intact",
  );
  assert.match(focused.at(-1).content, /Current wording/);
  assert.doesNotMatch(
    focused.at(-1).content,
    /Old starter|Unrelated content|Different scene/,
  );
  assert.equal(messages.at(-1).content, "Complete the current request.");
});

test("local inference uses only downloaded models and reports unsupported capabilities", async () => {
  const calls = [];
  const send = createOllamaAssistantFetch({
    fetcher: async (url) => {
      calls.push(url);
      return Response.json({ models: [{ name: "qwen3.5:9b" }] });
    },
  });
  const response = await send("https://getrestyle.app/api/assistant/status", {
    signal: signal(),
  });
  const status = await response.json();
  assert.equal(status.available, true);
  assert.equal(status.model, "qwen3.5:9b");
  assert.equal(status.capabilities.transcription, false);
  assert.deepEqual(calls, ["http://127.0.0.1:11434/api/tags"]);
  const audio = await send("https://getrestyle.app/api/assistant/transcribe", {
    signal: signal(),
  });
  assert.equal(audio.status, 503);
  assert.equal(
    calls.length,
    1,
    "Unsupported local features never fall back to Runpod",
  );
  assert.throws(() => localOllamaModels("qwen3:cloud"));
});

test("local turns keep native validation and constrain generation to the current schema", async () => {
  const send = createOllamaAssistantFetch({
    fetcher: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:11434/api/chat");
      const body = JSON.parse(options.body);
      assert.equal(body.think, false);
      assert.equal(body.model, "qwen3.5:9b");
      assert.equal(body.stream, false);
      assert.equal(body.options.num_ctx, 16384);
      assert.equal(body.options.temperature, 0);
      assert.equal(body.options.presence_penalty, 0);
      assert.ok(body.format.anyOf);
      return reply(JSON.stringify(draft));
    },
  });
  const result = await send("https://getrestyle.app/api/assistant/turn", {
    body: Buffer.from(JSON.stringify(project())),
    headers: {},
    signal: signal(),
  });
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).operations, draft.operations);
  const invalid = await send("https://getrestyle.app/api/assistant/turn", {
    body: Buffer.from("{}"),
    headers: {},
    signal: signal(),
  });
  assert.equal(invalid.status, 400);
});

test("local vision strips data URL framing and never sends images to a remote provider", async () => {
  const models = localOllamaModels("qwen3.5:9b", {
    fetcher: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:11434/api/chat");
      const body = JSON.parse(options.body);
      assert.deepEqual(body.messages[0].images, ["aGVsbG8="]);
      assert.equal(body.messages[0].content, "Read the title.");
      return reply("Hello");
    },
  });
  assert.equal(
    await models.describeFrame(
      { question: "Read the title.", image: "data:image/png;base64,aGVsbG8=" },
      signal(),
    ),
    "Hello",
  );
});

test("aborted or truncated local generation cannot produce a usable result", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const models = localOllamaModels("qwen3.5:9b", {
    fetcher: async () => {
      called = true;
    },
  });
  await assert.rejects(
    models.generate({ messages: [], maxTokens: 10 }, controller.signal),
  );
  assert.equal(called, false);
  const truncated = localOllamaModels("qwen3.5:9b", {
    fetcher: async () => Response.json({ done: true, done_reason: "length" }),
  });
  await assert.rejects(
    truncated.generate({ messages: [], maxTokens: 10 }, signal()),
    { code: "model_output_truncated" },
  );
});
