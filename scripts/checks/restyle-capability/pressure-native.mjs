import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSync } from "esbuild";
import { initSync } from "../../../packages/pvo-language/pkg/pvo_language.js";
import { compilePvoComponent } from "../../../packages/pvo-language/index.js";
import { nativeAssistantTurn } from "../../../server/assistant/native/service.js";

/** Apply live model proposals through the actual private-working-copy editor workflow. */
export async function runPressureNative(scenario, row, models, save) {
  initSync({
    module: new WebAssembly.Module(
      await readFile(
        new URL(
          "../../../packages/pvo-language/pkg/pvo_language_bg.wasm",
          import.meta.url,
        ),
      ),
    ),
  });
  const bundle = buildSync({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    export { runNativeTask } from './editor/src/infrastructure/assistant/runNativeTask.ts';
    export { prepareNativeBatch } from './editor/src/domain/assistant/native/batch.ts';
    export { nativeProjectFingerprint } from './editor/src/domain/assistant/native/context.ts';
  `,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  const api = await import(
    "data:text/javascript;base64," +
      Buffer.from(bundle.outputFiles[0].text).toString("base64")
  );
  let project = {
    currentSceneId: "main",
    ratio: "9:16",
    allowedDomains: [],
    scenes: [
      {
        id: "main",
        name: "Main",
        parent: null,
        muted: false,
        sound: -1,
        clips: [
          {
            id: 1,
            url: null,
            srcDur: 10,
            in: 0,
            out: 10,
            speed: 1,
            zoom: 1,
            mirror: false,
            color: "#000",
            width: 320,
            height: 240,
            fit: "contain",
          },
        ],
        texts:
          scenario.id === "E2"
            ? [
                {
                  id: 20,
                  text: "Keep Ω",
                  start: 1,
                  end: 3,
                  x: 50,
                  y: 50,
                  style: { font: "serif", size: 48, fill: "#ffffff" },
                },
              ]
            : [],
        components: [],
        audioClips: [],
        music: null,
        layers: scenario.id === "E2" ? ["video", "text:20"] : ["video"],
      },
    ],
  };
  const original = structuredClone(project);
  let nextId = 100,
    commits = 0;
  row.turns = [];
  row.events = [];
  const output = await api.runNativeTask(
    { prompt: scenario.request.prompt, mode: "edit", history: [] },
    {
      snapshot: () => structuredClone(project),
      playhead: () => 0,
      selection: () => scenario.request.project.selection,
      turn: async (request, signal) => {
        if (scenario.id === "E1")
          request.observations = [
            {
              kind: "transcript",
              sceneId: "main",
              start: 0,
              end: 10,
              text: "The answer is seven.",
              segments: [{ start: 4, end: 5, text: "The answer is seven." }],
            },
          ];
        const turn = { request };
        row.turns.push(turn);
        await save();
        turn.output = await nativeAssistantTurn(request, {
          models,
          signal,
          compile: compilePvoComponent,
          savedTasks: true,
        });
        await save();
        return turn.output;
      },
      observe: async (_project, request) => ({
        kind: "unavailable",
        sceneId: request.sceneId,
        requestedKind: request.kind,
        message:
          "Only the supplied transcript is available in this synthetic fixture.",
      }),
      prepare: (before, operations, signal) =>
        api.prepareNativeBatch(before, operations, {
          createId: () => nextId++,
          advancedEditingEnabled: false,
          compile: compilePvoComponent,
          signal,
        }),
      commit: (batch, fingerprint) => {
        assert.equal(fingerprint, api.nativeProjectFingerprint(project));
        assert.deepEqual(batch.before, project);
        commits++;
        project = structuredClone(batch.project);
      },
      progress: () => {},
      report: (event) => row.events.push(event),
    },
    AbortSignal.timeout(300000),
  );
  row.output = output;
  row.projectBefore = original;
  row.projectAfter = project;
  row.commits = commits;
  if (scenario.id === "E2") {
    const expected = structuredClone(original);
    expected.scenes[0].texts[0].start = 3;
    expected.scenes[0].texts[0].end = 5;
    assert.deepEqual(
      project,
      expected,
      "Relative edit must happen once and preserve all unrelated properties.",
    );
    assert.equal(commits, 1);
    row.status = "passed";
  } else {
    assert.equal(commits, 1);
    assert.deepEqual(project.scenes[0].clips, original.scenes[0].clips);
    row.status = "needs_semantic_grade";
  }
}
