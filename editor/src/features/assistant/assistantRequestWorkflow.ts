import { AssistantServiceError } from "../../domain/assistant/failure";
import type {
  AssistantAnswer,
  AssistantEvidence,
  AssistantMessage,
} from "../../domain/assistant/model";
import {
  validateNativeBatchEditingMode,
  validateNativeBatchEffects,
  type NativeBatch,
} from "../../domain/assistant/native/batch";
import { nativeProjectFingerprint } from "../../domain/assistant/native/context";
import type { AssistantTaskTrace } from "../../domain/assistant/taskDiagnostics";
import type { ProjectSnapshot } from "../../domain/project/model";
import {
  runNativeTask,
  type NativeTaskAdapters,
} from "../../infrastructure/assistant/runNativeTask";
import { assistantFailureReason } from "../../infrastructure/assistant/taskDiagnostics";
import type { AppliedAssistantChange } from "../../state/assistant/applyChanges";

type RequestInput = {
  prompt: string;
  history: AssistantMessage[];
  evidence: AssistantEvidence[];
};

export type AssistantRequestCompletion = {
  planned: NativeBatch | null;
  applied: AppliedAssistantChange | null;
  answer: AssistantAnswer;
  hasAnswer: boolean;
  history: AssistantMessage[];
  evidence: AssistantEvidence[];
};

type RequestFeedback = {
  working(): void;
  progress(label: string): void;
  completed(result: AssistantRequestCompletion): void;
  failed(error: unknown): void;
  cancelled(): void;
};

type RequestAdapters = {
  requestScope(): unknown;
  capture(): {
    localId: string | null;
    project: ProjectSnapshot;
    selection: ReturnType<NativeTaskAdapters["selection"]>;
  };
  availability(
    signal: AbortSignal,
  ): Promise<{ available: boolean; capabilities: { editing: boolean } }>;
  task: Pick<NativeTaskAdapters, "turn" | "observe" | "prepare" | "playhead">;
  advancedEditingEnabled(): boolean;
  apply(batch: NativeBatch): AppliedAssistantChange | null;
  feedback(prompt: string): RequestFeedback;
  createTrace(): (event: AssistantTaskTrace) => void;
};

/** One project-scoped request may apply one fully prepared batch. UI lifetime owns cancellation. */
export function createAssistantRequestWorkflow(adapters: RequestAdapters) {
  let active: {
    controller: AbortController;
    feedback: RequestFeedback;
  } | null = null;

  const cancel = () => {
    const previous = active;
    active = null;
    if (!previous) return;
    previous.controller.abort();
    previous.feedback.cancelled();
  };

  const submit = async (input: RequestInput) => {
    const prompt = input.prompt.trim();
    if (!prompt || active) return;
    const original = adapters.capture();
    const originalScope = adapters.requestScope();
    const fingerprint = nativeProjectFingerprint(original.project);
    const controller = new AbortController();
    const feedback = adapters.feedback(prompt);
    const request = { controller, feedback };
    active = request;
    const signal = controller.signal;
    const trace = adapters.createTrace();
    const observations: string[] = [];
    let message = "";
    let applying = false;
    const assertCurrent = () => {
      if (adapters.requestScope() !== originalScope) controller.abort();
      signal.throwIfAborted();
      const latest = adapters.capture();
      if (
        (original.localId !== null && latest.localId !== original.localId) ||
        nativeProjectFingerprint(latest.project) !== fingerprint
      ) {
        throw new Error(
          "The project changed while the assistant was working. Please ask again.",
        );
      }
    };

    try {
      assertCurrent();
      let availability;
      try {
        availability = await adapters.availability(signal);
      } catch {
        assertCurrent();
        throw new AssistantServiceError(503);
      }
      assertCurrent();
      if (!availability.available || !availability.capabilities.editing)
        throw new AssistantServiceError(503);
      feedback.working();
      const result = await runNativeTask(
        { ...input, prompt, mode: "plan" },
        {
          trace,
          snapshot: () => original.project,
          selection: () => original.selection,
          playhead: adapters.task.playhead,
          turn: async (request, taskSignal) => {
            assertCurrent();
            const response = await adapters.task.turn(request, taskSignal);
            assertCurrent();
            return response;
          },
          observe: async (project, observation, taskSignal) => {
            assertCurrent();
            const result = await adapters.task.observe(
              project,
              observation,
              taskSignal,
            );
            assertCurrent();
            return result;
          },
          prepare: async (project, operations, taskSignal, evidence) => {
            assertCurrent();
            const result = await adapters.task.prepare(
              project,
              operations,
              taskSignal,
              evidence,
            );
            assertCurrent();
            return result;
          },
          commit: () => {
            throw new Error(
              "Prepare a complete validated batch before applying changes.",
            );
          },
          progress: (label) => {
            assertCurrent();
            feedback.progress(label);
          },
          report: (event) => {
            if (event.observation) observations.push(event.message);
            else message = event.message;
          },
        },
        signal,
      );
      assertCurrent();
      const planned = result.batch;
      let applied = null;
      if (planned) {
        applying = true;
        trace({ stage: "application", status: "started" });
        validateNativeBatchEffects(planned);
        validateNativeBatchEditingMode(
          planned,
          adapters.advancedEditingEnabled(),
        );
        applied = adapters.apply(planned);
        trace({
          stage: "application",
          status: "completed",
          changed: Boolean(applied),
        });
        applying = false;
      }
      feedback.completed({
        planned,
        applied,
        history: result.history,
        evidence: result.evidence,
        answer: {
          request: prompt,
          message: result.answer ?? message,
          observations,
        },
        hasAnswer: Boolean(result.answer),
      });
    } catch (error) {
      if (adapters.requestScope() !== originalScope) controller.abort();
      if (applying)
        trace({
          stage: "application",
          status: "failed",
          reason: assistantFailureReason(error),
        });
      if (!signal.aborted && active === request) feedback.failed(error);
    } finally {
      // A cancelled request may finish after its replacement has already started.
      if (active === request) active = null;
    }
  };

  return { submit, cancel };
}
