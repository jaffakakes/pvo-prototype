/** Isolated experiment host; all editing, compilation, validation and history are real. */
export async function installStudyHarness({ root, fixture, advanced, timeoutMs, seedComponents = true, trial, phase }) {
  const { studyTurnEnvelope } = await import(`/@fs${root}/scripts/checks/editor/assistant-tool-study/transport.mjs`);
  const { useCapture } = await import("/src/state/captureStore.ts");
  const { initial } = await import("/src/state/project/initial.ts");
  const { projectSnapshot, restore } = await import("/src/state/project/history.ts");
  const { useEditorPreferences } = await import("/src/state/preferences/editorPreferences.ts");
  const { prepareNativeBatch } = await import("/src/domain/assistant/native/batch.ts");
  const { nativeProjectFingerprint } = await import("/src/domain/assistant/native/context.ts");
  const { commitNativeBatch } = await import("/src/state/assistant/nativeCommands.ts");
  const { runNativeTask } = await import("/src/infrastructure/assistant/runNativeTask.ts");
  const { parseNativeTurnResult } = await import(`/@fs${root}/packages/pvo-assistant/native/index.js`);
  const { inspectAssistantFrames } = await import("/src/infrastructure/assistant/media/frames.ts");
  const { transcribeAssistantAudio } = await import("/src/infrastructure/assistant/media/transcript.ts");
  const { AssistantServiceError } = await import("/src/domain/assistant/failure.ts");
  const { createDefaultComponent } = await import("/src/domain/components/editing.ts");
  const { componentLanguageModel } = await import("/src/domain/components/languageEditing.ts");
  const { fieldsShownFor } = await import("/src/domain/components/fields.ts");
  const { compilePvoComponent } = await import(`/@fs${root}/packages/pvo-language/index.js`);
  const main = fixture.scenes[0];
  const quiz = createDefaultComponent("quiz-main", "choice", main, 0);
  quiz.dur = 5;
  quiz.fields = { prompt: "What happens next?", options: [
    { label: "Go", outcome: { kind: "continue" } }, { label: "Stay", outcome: { kind: "continue" } },
  ] };
  const note = createDefaultComponent("note-main", "tooltip", main, 6);
  note.dur = 3;
  note.fields = { text: "Remember the ticket" };
  if (seedComponents) main.components = [quiz, note];
  const clean = initial();
  useCapture.setState({ ...clean, ...restore(clean, fixture), screen: "editor" });
  useEditorPreferences.setState({ advancedEditingEnabled: advanced });
  let nextId = 10000;
  let history = [];
  let evidence = [];
  const snapshot = () => projectSnapshot(useCapture.getState());
  const clone = value => JSON.parse(JSON.stringify(value));
  const semanticComponents = project => Object.fromEntries(project.scenes.flatMap(scene => scene.components.map(component => [
    component.id, { fields: fieldsShownFor(component), model: componentLanguageModel(component) },
  ])));
  const compactObservation = observation => observation.kind === "frames"
    ? { ...observation, frames: observation.frames.map(({ dataUrl, ...frame }) => ({ ...frame, imageBytes: dataUrl.length })) }
    : observation;
  window.__nativeStudy = {
    snapshot,
    async checkNativeAtomicity() {
      const before = clone(snapshot());
      const pastBefore = useCapture.getState().past.length;
      const batch = await prepareNativeBatch(snapshot(), [{ kind: "component.add",
        sceneId: before.currentSceneId, componentType: "tooltip", at: 0, duration: 1 }], {
        createId: () => nextId++, compile: compilePvoComponent, advancedEditingEnabled: advanced,
      });
      if (JSON.stringify(clone(snapshot())) !== JSON.stringify(before)) throw new Error("Dry-run preparation mutated the live project");
      const applied = commitNativeBatch(batch, nativeProjectFingerprint(batch.before), "edit");
      if (!applied || useCapture.getState().past.length !== pastBefore + 1) throw new Error("Dry-run edit did not create one history entry");
      const after = clone(snapshot());
      useCapture.getState().undo();
      if (JSON.stringify(clone(snapshot())) !== JSON.stringify(before)) throw new Error("Dry-run Undo did not restore the project");
      useCapture.getState().redo();
      if (JSON.stringify(clone(snapshot())) !== JSON.stringify(after)) throw new Error("Dry-run Redo did not restore the candidate");
      return { status: "PASS", nativePreparation: true, realCompiler: true, oneUndoEntry: true,
        exactUndo: true, exactRedo: true, providerCalls: 0 };
    },
    async run({ prompt, mode = "edit" }) {
      const before = snapshot();
      const pastBefore = useCapture.getState().past.length;
      const startedAt = new Date().toISOString();
      const started = performance.now();
      const elapsed = () => Math.round(performance.now() - started);
      const turns = [], observations = [], preparations = [], traces = [], progress = [], atomicViolations = [];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("Acceptance request deadline exceeded.")), timeoutMs);
      const assertPrivate = label => {
        if (JSON.stringify(snapshot()) !== JSON.stringify(before)) atomicViolations.push(label);
      };
      let result = null, failure = null, applied = false, commitCalls = 0;
      try {
        result = await runNativeTask({ prompt, mode, history, evidence }, {
          snapshot,
          playhead: () => 0,
          selection: () => ({ clipId: null, textId: null, componentId: null, audioId: null }),
          turn: async (request, signal) => {
            assertPrivate("before model turn");
            const turn = { atMs: elapsed(), request: { ...request, observations: request.observations.map(compactObservation) } };
            turns.push(turn);
            try {
              const http = await fetch("/__study/turn", {
                method: "POST", headers: { "Content-Type": "application/json" }, signal,
                body: JSON.stringify(studyTurnEnvelope(trial, phase, request)),
              });
              const value = await http.json();
              turn.telemetry = value.telemetry ?? [];
              if (!http.ok) throw new AssistantServiceError(http.status, value.error ?? `Study request failed (${http.status}).`);
              const response = parseNativeTurnResult(value.result);
              turn.response = response;
              return response;
            } catch (error) {
              turn.error = { name: error.name, message: error.message, status: error.status, reason: error.reason };
              throw error;
            } finally { turn.durationMs = elapsed() - turn.atMs; assertPrivate("after model turn"); }
          },
          observe: async (project, request, signal) => {
            const observation = { atMs: elapsed(), request };
            observations.push(observation);
            try {
              const value = phase === "frozen"
                ? await window.__studyObserve(project, request)
                : request.kind === "frames" ? await inspectAssistantFrames(project, request, { signal })
                  : await transcribeAssistantAudio(project, request, { signal });
              signal.throwIfAborted();
              observation.result = compactObservation(value);
              return value;
            } catch (error) {
              signal.throwIfAborted();
              observation.error = { name: error.name, message: error.message, status: error.status };
              if (error instanceof AssistantServiceError && error.status === 429) throw error;
              const unavailable = { kind: "unavailable", sceneId: request.sceneId, requestedKind: request.kind,
                message: "This media section could not be inspected. Do not guess its contents." };
              observation.result = unavailable;
              return unavailable;
            } finally { observation.durationMs = elapsed() - observation.atMs; assertPrivate("after media observation"); }
          },
          prepare: async (project, operations, signal) => {
            const preparation = { atMs: elapsed(), operations };
            preparations.push(preparation);
            try {
              const batch = await prepareNativeBatch(project, operations, {
                createId: () => nextId++, compile: compilePvoComponent, advancedEditingEnabled: advanced, signal,
              });
              preparation.candidateFingerprint = nativeProjectFingerprint(batch.project);
              return batch;
            } catch (error) {
              preparation.error = { name: error.name, message: error.message };
              throw error;
            } finally { preparation.durationMs = elapsed() - preparation.atMs; assertPrivate("after native preparation"); }
          },
          commit: (batch, fingerprint) => {
            assertPrivate("before final atomic commit");
            commitCalls += 1;
            applied = commitNativeBatch(batch, fingerprint, "edit");
          },
          progress: label => progress.push({ atMs: elapsed(), label }),
          report: () => {},
          trace: event => traces.push({ atMs: elapsed(), ...event }),
        }, controller.signal);
        history = result.history;
        evidence = result.evidence;
      } catch (error) {
        failure = { name: error.name, message: error.message, reason: error.reason, status: error.status };
      } finally { clearTimeout(timeout); }
      const endToEndMs = elapsed();
      const endedAt = new Date().toISOString();
      const after = snapshot();
      const pastAfter = useCapture.getState().past.length;
      let undone = null, redone = null;
      if (pastAfter > pastBefore) {
        useCapture.getState().undo();
        undone = snapshot();
        useCapture.getState().redo();
        redone = snapshot();
      }
      return clone({ prompt, before, after, pastBefore, pastAfter, undone, redone, atomicViolations,
        applied, commitCalls, failure, startedAt, endedAt, endToEndMs, turns, observations, preparations, traces, progress,
        components: semanticComponents(after), history, evidence,
        result: result ? { message: result.message, answer: result.answer,
          operations: result.batch?.operations ?? [], playback: result.batch?.playback ?? [],
          exportFormat: result.batch?.exportFormat ?? null } : null,
      });
    },
  };
  return clone({ project: snapshot(), fingerprint: nativeProjectFingerprint(snapshot()), components: semanticComponents(snapshot()) });
}
