import { TASK_FAILURES, TASK_LIMITS as limits } from "./limits.js";
import {
  choice,
  digest,
  id,
  integer,
  list,
  object,
  requireTask,
  text,
  time,
  unique,
} from "./validation.js";

export function validateContext(value) {
  object(value, ["fingerprint", "components"], "Task context");
  text(value.fingerprint, limits.fingerprintBytes, "Project fingerprint");
  list(value.components, limits.components, "Components");
  for (const component of value.components) {
    object(component, ["id", "sceneId", "type", "source"], "Component context");
    id(component.id, "Component ID");
    id(component.sceneId, "Scene ID");
    choice(
      component.type,
      ["tooltip", "card", "choice", "form"],
      "Component type",
    );
    object(
      component.source,
      ["structure", "style", "logic"],
      "Component source",
    );
    for (const part of ["structure", "style", "logic"])
      text(
        component.source[part],
        limits.sourceBytes,
        "Component source",
        true,
      );
  }
  unique(
    value.components.map((component) => `${component.sceneId}:${component.id}`),
    "Component identities",
  );
}

export function validateExamples(value) {
  list(value, limits.examples, "Behavior examples");
  for (const example of value) {
    object(example, ["id", "input", "expected"], "Behavior example");
    id(example.id, "Example ID");
    text(example.input, limits.exampleBytes, "Example input");
    text(example.expected, limits.exampleBytes, "Expected behavior");
  }
  unique(
    value.map((example) => example.id),
    "Example IDs",
  );
}

export function validateArtifact(value) {
  object(value, ["id", "sha256", "bytes"], "Artifact reference");
  id(value.id, "Artifact ID");
  digest(value.sha256, "Artifact digest");
  integer(value.bytes, limits.artifactBytes, "Artifact bytes", 1);
}

export function validateResult(value) {
  object(value, ["artifact", "baseFingerprint"], "Prepared result");
  validateArtifact(value.artifact);
  text(value.baseFingerprint, limits.fingerprintBytes, "Result fingerprint");
}

export function validateFailure(value) {
  object(value, ["code", "stepId"], "Task failure");
  choice(value.code, Object.keys(TASK_FAILURES), "Failure code");
  id(value.stepId, "Failed step ID");
}

export function validateQuestion(value) {
  object(value, ["id", "revision", "prompt", "choices", "answer"], "Question");
  id(value.id, "Question ID");
  integer(value.revision, 1, "Question revision");
  text(value.prompt, limits.questionBytes, "Question prompt");
  list(value.choices, limits.choices, "Question choices");
  for (const option of value.choices)
    text(option, limits.choiceBytes, "Question choice");
  unique(value.choices, "Question choices");
  if (value.answer !== null) {
    object(value.answer, ["operationId", "value", "answeredAt"], "Answer");
    id(value.answer.operationId, "Answer operation ID");
    text(value.answer.value, limits.answerBytes, "Answer text");
    time(value.answer.answeredAt, "Answer time");
  }
  requireTask(
    value.revision === (value.answer === null ? 0 : 1),
    "Question revision does not match its answer.",
  );
}

export function validateUsage(value) {
  object(
    value,
    ["modelTurns", "toolCalls", "reservedModelTurns", "reservedToolCalls"],
    "Task usage",
  );
  integer(value.modelTurns, limits.modelTurns, "Used model turns");
  integer(value.toolCalls, limits.toolCalls, "Used tool calls");
  integer(
    value.reservedModelTurns,
    limits.modelTurns - value.modelTurns,
    "Reserved model turns",
  );
  integer(
    value.reservedToolCalls,
    limits.toolCalls - value.toolCalls,
    "Reserved tool calls",
  );
}
