# Isolated media-tool interface experiment

This tooling compares existing separate observations with an **optional** coordinated `inspect_media` helper. The separate interface already permits transcript and frames in the same model response. Both arms expand into the same native operations, observation budgets, scheduler, candidate preparation, compiler, policy and Undo boundary. This does not change the shipped app or its UI.

The preregistered primary study uses 10 cases × 3 repetitions × 2 arms (60 trials). Adjacent pairs have the same case, prompts and initial project; first-arm order alternates by case and repetition and case order is reproducibly shuffled. The live confirmation is a separate 3 cases × 2 repetitions × 2 arms (12 trials). Do not pool the stages as an end-to-end performance benchmark.

The frozen stage uses recorded real ASR output and exact cached visual descriptions. It measures the interface's effect on planning, evidence selection and final outcomes. It does not measure new transcription or vision latency. The live stage uses the actual browser media adapters and provider. Neither stage fabricates model responses.

Prerequisites: an installed Chrome (`CHROME_PATH` overrides the macOS default), built language WASM, a fresh isolated Vite server, the corpus evidence bank, and a standalone study server on5199 connected to the root-owned MCP relay on5197. The study runner never calls the user's beta4174. Do not start live inference without coordinating the relay pump.

```sh
node --test scripts/checks/editor/assistant-tool-study/schedule.test.mjs
node scripts/checks/editor/assistant-tool-study/run.mjs --list

# Zero model calls: seek and render both registered frame windows, comparing exact pixels with a blob control.
node scripts/checks/editor/assistant-tool-study/frame-preflight.mjs --editor-url=http://127.0.0.1:5196/ --output=/tmp/pvo-assistant-tool-study-frame-preflight-v2

# Zero model calls: load all10 fixtures and check actual preparation/compiler/Undo/Redo.
node scripts/checks/editor/assistant-tool-study/run.mjs --phase=frozen --dry-run --editor-url=http://127.0.0.1:5196/ --output=/tmp/pvo-assistant-tool-study-dry-run

# Run only after all executable study/source files and the evidence bank are frozen.
node scripts/checks/editor/assistant-tool-study/run.mjs --phase=frozen --editor-url=http://127.0.0.1:5196/ --study-url=http://127.0.0.1:5199 --output=/tmp/pvo-assistant-tool-study-primary
node scripts/checks/editor/assistant-tool-study/run.mjs --phase=live --editor-url=http://127.0.0.1:5196/ --study-url=http://127.0.0.1:5199 --output=/tmp/pvo-assistant-tool-study-live
```

Every output directory must be new. The runner writes `preregistration.json` and `source-manifest.json` before provider work. It refuses changed executable source, compiler WASM, evidence bank or source media during a live run. `--plan-only` writes registration without launching a browser. `--cases=id,...`, `--replicates=N`, `--seed=N`, `--bank=/path/bank.json`, and `--timeout-ms=N` are explicit study controls and are recorded; changing them creates a new experiment. Defaults are serial execution, seed20261002 and300000ms per user request.

Each trial has an isolated browser context, stable test-only media URL, initial project snapshot, individual `step-N.json` files and `result.json`. Steps record real provider responses, normalized tool calls, private candidate preparations, exact before/after/Undo/Redo snapshots, diagnostics, timestamps and semantic assertions. The stable local URL keeps random blob IDs from changing paired project fingerprints; all contexts receive the same verified file bytes.

The media fixture serves proper HTTP byte ranges so the browser can seek to the requested source frames. Live V1 used an HTTP200-only route, which made the source nonseekable and caused frame timeouts before vision inference. Its results remain retained as infrastructure failures. The corrected live V2 must use a new output directory and preregistration; it changes the fixture transport only, with identical media, prompts, oracles and application source. `frame-preflight.mjs` exercises the same fixture loader and real native frame adapter without provider calls before starting paid inference.

`progress.json` is updated after each trial; `summary.json` appears when the run finishes or stops. Failed prerequisites stop that case's follow-ups, while independent pairs continue. Infrastructure errors and semantic failures remain in the raw artifacts. There are no automatic model retries outside the unchanged native service's existing review/repair behavior and no automatic rerun of scored cases.

Report logical tool requests, canonical modality executions, frames requested, audio seconds requested, native turns and provider generation/review/repair calls separately. Frozen cached vision lookups are not new GPU inference. `requestMs` includes the real planning service and any manual MCP relay delay; media extraction and operation preparation have separate timings. Playback/export effects are recorded but not executed by this runner. PASS means the registered case assertions passed, not general autonomy or manual-editor parity.
