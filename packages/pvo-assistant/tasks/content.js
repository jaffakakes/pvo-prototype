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
  if (value && Object.hasOwn(value, "container")) {
    object(value, ["fingerprint", "container"], "Container task context");
    text(value.fingerprint, limits.fingerprintBytes, "Draft fingerprint");
    object(
      value.container,
      ["serviceId", "revision", "mode"],
      "Saved Container target",
    );
    id(value.container.serviceId, "Container identity");
    choice(value.container.mode, ["edit", "test"], "Container task mode");
    integer(
      value.container.revision,
      Number.MAX_SAFE_INTEGER,
      "Starting draft revision",
    );
    return;
  }
  object(
    value,
    ["fingerprint", "currentSceneId", "scenes", "components"],
    "Task context",
  );
  text(value.fingerprint, limits.fingerprintBytes, "Project fingerprint");
  id(value.currentSceneId, "Current scene ID");
  list(value.scenes, limits.scenes, "Task scenes");
  for (const scene of value.scenes) {
    object(scene, ["id", "name", "duration"], "Task scene");
    id(scene.id, "Scene ID");
    text(scene.name, 480, "Scene name");
    requireTask(
      typeof scene.duration === "number" &&
        Number.isFinite(scene.duration) &&
        scene.duration >= 0 &&
        scene.duration <= 86400,
      "Task scene duration must be within one day.",
    );
  }
  unique(
    value.scenes.map((scene) => scene.id),
    "Task scene IDs",
  );
  const scenes = new Set(value.scenes.map((scene) => scene.id));
  requireTask(
    scenes.has(value.currentSceneId),
    "The current task scene is missing.",
  );
  list(value.components, limits.components, "Components");
  for (const component of value.components) {
    object(
      component,
      ["id", "sceneId", "type", "sourceVisibility", "source"],
      "Component context",
    );
    id(component.id, "Component ID");
    id(component.sceneId, "Scene ID");
    requireTask(
      scenes.has(component.sceneId),
      "A task component refers to a missing scene.",
    );
    choice(
      component.sourceVisibility,
      ["full", "design"],
      "Component source visibility",
    );
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
  integer(value.modelTurns, Number.MAX_SAFE_INTEGER, "Used model turns");
  integer(value.toolCalls, Number.MAX_SAFE_INTEGER, "Used tool calls");
  integer(
    value.reservedModelTurns,
    Number.MAX_SAFE_INTEGER - value.modelTurns,
    "Reserved model turns",
  );
  integer(
    value.reservedToolCalls,
    Number.MAX_SAFE_INTEGER - value.toolCalls,
    "Reserved tool calls",
  );
}
