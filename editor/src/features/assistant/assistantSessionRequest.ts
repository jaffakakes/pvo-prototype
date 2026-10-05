import { compilePvoComponent } from "../../../../packages/pvo-language/index.js";
import { appliedAssistantSummary } from "../../domain/assistant/appliedSummary";
import { AssistantServiceError } from "../../domain/assistant/failure";
import { prepareNativeBatch } from "../../domain/assistant/native/batch";
import { inspectAssistantFrames } from "../../infrastructure/assistant/media/frames";
import {
  trackAssistantObject,
  TrackingSelectionError,
} from "../../infrastructure/assistant/media/objectTracking";
import { transcribeAssistantAudio } from "../../infrastructure/assistant/media/transcript";
import { alignAssistantWords } from "../../infrastructure/assistant/media/wordTiming";
import {
  readNativeAvailability,
  requestNativeTurn,
} from "../../infrastructure/assistant/nativeTransport";
import { createAssistantTrace } from "../../infrastructure/assistant/taskDiagnostics";
import {
  inspectWebTool,
  isWebObservationRequest,
  prepareAssistantFonts,
} from "../../infrastructure/assistant/webTools";
import { readSavedFonts } from "../../infrastructure/fonts/library";
import { uid } from "../../infrastructure/ids";
import { applyAssistantChanges } from "../../state/assistant/applyChanges";
import { useAssistant } from "../../state/assistant/assistantStore";
import { useAssistantScope } from "../../state/assistant/sessionScope";
import { notifyAssistantApplied } from "../../state/assistant/nativeAppliedNotification";
import {
  completeAssistantExchange,
  finishAssistantExchange,
  setAssistantThreadOpen,
  startAssistantExchange,
  updateAssistantExchangeProgress,
  useAssistantThread,
} from "../../state/assistant/threadStore";
import { useCapture } from "../../state/captureStore";
import {
  obtainLibraryFont,
  saveLibraryFont,
} from "../../state/fonts/fontLibraryStore";
import { clearNotificationScope } from "../../state/notifications/notificationStore";
import { useEditorPreferences } from "../../state/preferences/editorPreferences";
import { projectSnapshot } from "../../state/project/history";
import { createAssistantRequestWorkflow } from "./assistantRequestWorkflow";

type SessionEffects = {
  pause(): void;
  restorePlayback(): void;
  releasePlayback(): void;
  report(error: unknown, operation: string): void;
  nextOperation(): number;
};

/** Compose existing editor effects at the request boundary, outside React rendering. */
export function createAssistantSessionRequest(effects: SessionEffects) {
  return createAssistantRequestWorkflow({
    requestScope: () => useAssistantScope.getState().epoch,
    capture: () => {
      const current = useCapture.getState();
      return {
        localId: current.localId,
        project: projectSnapshot(current),
        selection: {
          clipId: current.clips[current.sel]?.id ?? null,
          textId: current.selText,
          componentId: current.selComp,
          audioId: current.selAudio,
        },
      };
    },
    availability: readNativeAvailability,
    createTrace: createAssistantTrace,
    advancedEditingEnabled: () =>
      useEditorPreferences.getState().advancedEditingEnabled,
    apply: applyAssistantChanges,
    task: {
      playhead: () => useCapture.getState().t,
      turn: requestNativeTurn,
      observe: async (project, observation, signal) => {
        if (isWebObservationRequest(observation)) {
          return inspectWebTool(observation, signal, {
            list: readSavedFonts,
            save: saveLibraryFont,
          });
        }
        try {
          switch (observation.kind) {
            case "frames":
              return await inspectAssistantFrames(project, observation, {
                signal,
              });
            case "transcript":
              return await transcribeAssistantAudio(project, observation, {
                signal,
              });
            case "word_timing":
              return await alignAssistantWords(project, observation, {
                signal,
              });
            case "object_tracking":
              return await trackAssistantObject(project, observation, {
                signal,
              });
          }
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof AssistantServiceError && error.status === 429)
            throw error;
          return {
            kind: "unavailable",
            sceneId: observation.sceneId,
            requestedKind: observation.kind,
            message:
              error instanceof TrackingSelectionError
                ? error.message
                : "This media section could not be inspected. Do not guess its contents.",
          };
        }
      },
      prepare: async (project, operations, signal, trackingEvidence) =>
        prepareNativeBatch(project, operations, {
          fonts: await prepareAssistantFonts(
            operations,
            signal,
            obtainLibraryFont,
          ),
          createId: uid,
          compile: compilePvoComponent,
          signal,
          advancedEditingEnabled:
            useEditorPreferences.getState().advancedEditingEnabled,
          trackingEvidence,
        }),
    },
    feedback: (prompt) => {
      const prior = useAssistant.getState();
      const exchangeId = startAssistantExchange(prompt);
      return {
        working: () => {
          effects.pause();
          useAssistant.setState({
            phase: "working",
            draft: prompt,
            transcript: "",
            progress: "",
            failureDetail: null,
          });
          clearNotificationScope("assistant");
        },
        progress: (progress) => {
          useAssistant.setState({ progress });
          updateAssistantExchangeProgress(exchangeId, progress);
        },
        cancelled: () => finishAssistantExchange(exchangeId, "cancelled"),
        failed: (error) => {
          finishAssistantExchange(
            exchangeId,
            "failed",
            "Could not complete this request.",
          );
          useAssistant.setState({
            phase: prior.answer ? "review" : "typing",
            draft: prompt,
            progress: "",
          });
          effects.report(error, "request");
        },
        completed: ({
          planned,
          applied,
          answer,
          hasAnswer,
          history,
          evidence,
        }) => {
          if (
            !planned ||
            (!applied && !planned.playback.length && !planned.exportFormat)
          ) {
            completeAssistantExchange(exchangeId, { response: answer.message });
            setAssistantThreadOpen(false);
            useAssistant.setState({
              phase: "review",
              progress: "",
              answer,
              history,
              evidence,
            });
            return;
          }
          completeAssistantExchange(exchangeId, {
            response: answer.message,
            summary: applied
              ? appliedAssistantSummary(planned.operations)
              : undefined,
            change: applied ?? undefined,
          });
          if (planned.playback.length) effects.releasePlayback();
          if (hasAnswer || planned.playback.length || planned.exportFormat)
            setAssistantThreadOpen(false);
          useAssistant.setState({
            phase: hasAnswer ? "review" : "idle",
            answer: hasAnswer ? answer : null,
            progress: "",
            draft: "",
            evidence,
            history: [
              ...history,
              {
                role: "assistant" as const,
                content:
                  "The editor completed the validated operations. Use the current project for any follow-up.",
              },
            ].slice(-12),
          });
          clearNotificationScope("assistant");
          if (!hasAnswer && !useAssistantThread.getState().open)
            effects.restorePlayback();
          if (applied)
            notifyAssistantApplied(
              applied,
              planned.operations,
              `apply:${effects.nextOperation()}`,
            );
        },
      };
    },
  });
}
