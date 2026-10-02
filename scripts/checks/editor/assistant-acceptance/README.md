# Real-provider native assistant acceptance

This opt-in runner sends real requests to the configured native assistant API. It uses an isolated Chrome context per case, the editor's actual `runNativeTask`, media adapters, native preparation, WASM compiler, store commit and Undo/Redo. It never supplies model response fixtures and never opens or modifies the user's browser or saved project.

Start the source preview in this checkout (`npx vite --config editor/vite.config.ts --host 127.0.0.1 --port 5196 --strictPort`) and arrange a working real assistant API. Provider use can incur charges. The runner does not start infrastructure or configure credentials.

```sh
node scripts/checks/editor/assistant-acceptance/run.mjs --list
node scripts/checks/editor/assistant-acceptance/run.mjs --fixture-only --cases=multi-edit --output=/tmp/pvo-fixture-check
node scripts/checks/editor/assistant-acceptance/run.mjs --cases=multi-edit,quiz-reveal,followup-memory --api-url=http://127.0.0.1:4174 --editor-url=http://127.0.0.1:5196/ --concurrency=1 --output=/tmp/pvo-real-acceptance
```

Omit `--cases` to run every registered case. `--concurrency` accepts 1 or 2, defaults to 1, and isolates state per case. `--timeout-ms` bounds each user request (default 300000). `--media-path` overrides the real local fixture video. The default editing fixture uses the repository's sample video in three source ranges and authors a 12-second scene. Media-specific cases can supply a different file and project factory. `--fixture-only` seeds and validates browser setup without invoking the assistant loop.

Each case writes its initial project, one JSON artifact per completed request, a final screenshot and result. The suite continues to independent cases after a failure; it stops dependent follow-ups within that failed case. `summary.json` distinguishes `PASS`, `FAIL`, and `CAPABILITY_GAP`. A gap means an unsupported request was honestly blocked with no project mutation; it does **not** mean the capability exists or manual editor parity is complete.

Every request checks private candidate isolation, one history entry for a complete edit, exact Undo/Redo and scenario-specific semantic postconditions. Follow-up cases preserve actual authored state and completed conversation. Failed workflows must leave the project unchanged. The transcript/frame adapters inspect real media when requested. Image payloads are removed from artifacts; prompts, authored project state and transcription text remain local in the chosen output directory.

Timings include all native API wait, media extraction, compiler and application work. If the API uses a manually serviced relay, its latency is included. Native turn requests are counted separately from observations and preparations; underlying provider calls, review/repair calls, GPU queue and execution time require server/provider telemetry. Playback/export host operations are recorded but not executed. `quiz-reveal` additionally exercises the real model-produced quiz through rendered Try controls on desktop and mobile: both answers resume, unanswered footage remains held, and early answers wait until the layer end. `browser-verification.json` records media clocks, native pause times, visible controls, authored-state preservation and separate viewer-verification duration. This is skipped when model assertions fail and never patches the generated result. These cases do not certify final file export.

Additional `media-cases.mjs` can export `mediaCases`, with entries `{ id, title, mediaPath, seedComponents:false, fixture(media), steps }`. Each step provides `{ prompt, expect:'edit'|'unchanged'|'blocked', maxObservations?, verify(step,{steps,initial}) }`. `media` contains the decoded `url`, `duration`, `width`, `height`. `step` includes before/after snapshots, result, semantic component fields/models, native turns, real observation results, timings, traces and Undo/Redo snapshots. A case may enable `advanced:true`; a step may explicitly select `mode:'ask'`.
