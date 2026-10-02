/** Runs in an isolated browser context against the real editor domain, store and compiler. */
export async function installAcceptanceHarness({ root, fixture, advanced, timeoutMs, seedComponents = true }) {
  const { useCapture } = await import("/src/state/captureStore.ts");
  const { initial } = await import("/src/state/project/initial.ts");
  const { projectSnapshot, restore } = await import("/src/state/project/history.ts");
  const { useEditorPreferences } = await import("/src/state/preferences/editorPreferences.ts");
  const { prepareNativeBatch } = await import("/src/domain/assistant/native/batch.ts");
  const { nativeProjectFingerprint } = await import("/src/domain/assistant/native/context.ts");
  const { commitNativeBatch } = await import("/src/state/assistant/nativeCommands.ts");
  const { runNativeTask } = await import("/src/infrastructure/assistant/runNativeTask.ts");
  const { requestNativeTurn } = await import("/src/infrastructure/assistant/nativeTransport.ts");
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
  window.__nativeAcceptance = {
    snapshot,
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
              const response = await requestNativeTurn(request, signal);
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
              const value = request.kind === "frames" ? await inspectAssistantFrames(project, request, { signal })
                : await transcribeAssistantAudio(project, request, { signal });
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
  return clone({ project: snapshot(), components: semanticComponents(snapshot()) });
}
