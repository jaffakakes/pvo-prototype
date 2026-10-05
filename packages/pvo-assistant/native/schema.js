import { taskProposalSchema } from "../tasks/index.js";
import {
  ANIMATION_EASINGS,
  ANIMATION_LIMITS,
  ANIMATION_PROPERTIES,
} from "../../pvo-animation/index.js";
import {
  webObservationRequests,
  webObservations,
  fontSummarySchema,
} from "./webSchema.js";

const number = (minimum = 0, maximum = 86400) => ({
  type: "number",
  minimum,
  maximum,
});
const string = (maxLength = 2000) => ({ type: "string", maxLength });
const enumeration = (values) => ({ type: "string", enum: values });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const array = (items, maxItems) => ({ type: "array", items, maxItems });
const boolean = { type: "boolean" };
const id = string(128);
const numericId = {
  type: "integer",
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
};
const time = number();
const position = number(0, 100);
const gain = number(0, 1);
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const ratio = enumeration(["9:16", "1:1", "4:5", "16:9"]);
const componentType = enumeration(["tooltip", "card", "choice", "form"]);
const responsePolicySchema = object({
  dispatch: enumeration(["interaction", "layer_end"]),
  unanswered: enumeration(["continue", "pause"]),
});
const componentScale = number(0.25, 3);
const componentPixels = nullable(number(1, 16384));
export const sourceSchema = object({
  structure: string(20000),
  style: string(20000),
  logic: string(20000),
});
export const textStyleSchema = object(
  {
    font: enumeration(["sans", "display", "serif", "mono", "condensed"]),
    size: number(1, 300),
    bold: boolean,
    italic: boolean,
    underline: boolean,
    fill: string(80),
    background: string(80),
    stroke: string(80),
    strokeWidth: number(0, 20),
    shadow: boolean,
    align: enumeration(["left", "center", "right"]),
    spacing: number(-20, 100),
    lineHeight: number(0.1, 10),
    opacity: gain,
    rotation: number(-360, 360),
    box: boolean,
  },
  [],
);
const textChanges = {
  text: string(4000),
  start: time,
  end: time,
  x: position,
  y: position,
  style: textStyleSchema,
};
const scene = { sceneId: id };
const clip = { ...scene, clipId: numericId };
const audio = { ...scene, audioId: numericId };
const alignmentSource = object({
  kind: enumeration(["clip", "audio"]),
  id: numericId,
});
const alignmentProvenance = object({
  method: { const: "forced_alignment" },
  engine: { const: "mfa" },
  version: string(200),
  acousticModel: string(200),
  dictionary: string(200),
  language: { const: "en" },
  transcriptVerified: { const: false },
  refined: boolean,
});
const component = { ...scene, componentId: id };
const animationProperty = enumeration(ANIMATION_PROPERTIES);
const animationTracks = object(
  Object.fromEntries(
    ANIMATION_PROPERTIES.map((property) => [
      property,
      array(
        object({
          time,
          value: number(...ANIMATION_LIMITS[property]),
          easing: enumeration(ANIMATION_EASINGS),
        }),
        4096,
      ),
    ]),
  ),
  [],
);
const animation = object({ tracks: animationTracks });
const animationTarget = {
  anyOf: [
    object({ kind: enumeration(["clip", "audio", "text"]), id: numericId }),
    object({ kind: { const: "component" }, id }),
    object({ kind: { const: "music" } }),
  ],
};
const visualAnimationTarget = {
  anyOf: [
    object({ kind: enumeration(["clip", "text"]), id: numericId }),
    object({ kind: { const: "component" }, id }),
  ],
};
const trackingTarget = {
  anyOf: [
    object({ kind: { const: "text" }, text: { ...string(200), minLength: 1 } }),
    object({ kind: { const: "point" }, x: gain, y: gain }),
  ],
};
const operation = (kind, properties, required) =>
  object({ kind: { const: kind }, ...properties }, [
    "kind",
    ...(required ?? Object.keys(properties)),
  ]);
export const operationSchemas = [
  operation("font.apply", {
    ...scene,
    target: {
      anyOf: [
        object({ kind: { const: "component" }, id }),
        object({ kind: { const: "text" }, id: numericId }),
      ],
    },
    fontId: nullable(id),
  }),
  operation("animation.follow", {
    ...scene,
    target: visualAnimationTarget,
    observationId: id,
    anchor: enumeration(["center", "top"]),
    offsetX: number(-100, 100),
    offsetY: number(-100, 100),
  }),
  operation("animation.set", {
    ...scene,
    target: animationTarget,
    tracks: animationTracks,
  }),
  operation("animation.remove", {
    ...scene,
    target: animationTarget,
    property: animationProperty,
    time,
  }),
  operation(
    "animation.clear",
    { ...scene, target: animationTarget, property: animationProperty },
    ["sceneId", "target"],
  ),
  operation("text.add", { ...scene, ...textChanges }, [
    "sceneId",
    "text",
    "start",
    "end",
  ]),
  operation("text.update", {
    ...scene,
    textId: numericId,
    changes: object(textChanges, []),
  }),
  operation("text.delete", { ...scene, textId: numericId }),
  operation("clip.trim", { ...clip, sourceIn: time, sourceOut: time }),
  operation("clip.split", { ...clip, time }),
  operation("clip.move", {
    ...clip,
    index: { type: "integer", minimum: 0, maximum: 1000 },
  }),
  ...["clip.duplicate", "clip.delete", "audio.extract"].map((kind) =>
    operation(kind, clip),
  ),
  operation("clip.update", {
    ...clip,
    changes: object(
      {
        speed: number(0.25, 4),
        zoom: number(0.5, 2),
        mirror: boolean,
        fit: enumeration(["cover", "contain"]),
      },
      [],
    ),
  }),
  operation("audio.update", {
    ...audio,
    changes: object(
      { start: time, sourceIn: time, sourceOut: time, muted: boolean, gain },
      [],
    ),
  }),
  operation("audio.split", { ...audio, time }),
  operation("audio.delete", audio),
  operation("scene.add", { parentId: id, name: string(120) }),
  operation("scene.update", {
    ...scene,
    changes: object(
      { name: string(120), muted: boolean, musicGain: gain, clipGain: gain },
      [],
    ),
  }),
  operation("scene.delete", scene),
  operation("scene.duplicate", scene),
  operation("project.ratio", { ratio }),
  operation(
    "component.add",
    {
      ...scene,
      componentType,
      at: time,
      duration: nullable(number(0.5)),
      source: sourceSchema,
      responsePolicy: responsePolicySchema,
    },
    ["sceneId", "componentType", "at", "duration"],
  ),
  operation("component.update", {
    ...component,
    changes: object(
      {
        at: time,
        duration: nullable(number(0.5)),
        x: position,
        y: position,
        scale: componentScale,
        scaleX: nullable(componentScale),
        scaleY: nullable(componentScale),
        width: componentPixels,
        height: componentPixels,
        responsePolicy: responsePolicySchema,
      },
      [],
    ),
  }),
  operation("component.content", {
    ...component,
    changes: object(
      {
        text: string(),
        title: string(),
        body: string(),
        prompt: string(),
        heading: string(),
        submitLabel: string(),
        buttonLabels: array(string(200), 2),
        optionLabels: array(string(200), 2),
      },
      [],
    ),
  }),
  operation("component.style", { ...component, style: string(20000) }),
  operation("component.source", { ...component, source: sourceSchema }),
  operation("component.delete", component),
  operation("playback.seek", { ...scene, time }),
  operation("playback.play", {}),
  operation("playback.pause", {}),
  operation("export.prepare", { format: enumeration(["video", "pvo"]) }),
];
export const observationRequestSchema = {
  anyOf: [
    ...webObservationRequests,
    operation("object_tracking", {
      ...scene,
      clipId: numericId,
      start: time,
      end: time,
      target: trackingTarget,
    }),
    operation("frames", {
      ...scene,
      start: time,
      end: time,
      count: { type: "integer", minimum: 1, maximum: 6 },
    }),
    operation("transcript", { ...scene, start: time, end: time }),
    operation("word_timing", {
      ...scene,
      start: time,
      end: time,
      source: alignmentSource,
      text: { ...string(4000), minLength: 1 },
      language: { const: "en" },
    }),
  ],
};
export const nativeTurnSchema = object(
  {
    message: string(8000),
    operations: array({ anyOf: operationSchemas }, 24),
    observations: array(observationRequestSchema, 4),
    cloudTask: taskProposalSchema,
    blocked: { type: "boolean", const: true },
    answer: { ...string(8000), minLength: 1 },
    evidence: array({ ...string(2000), minLength: 1 }, 6),
  },
  ["message", "operations", "observations"],
);
const projectSchema = object({
  fingerprint: string(128),
  currentSceneId: id,
  playhead: time,
  ratio,
  canvas: object({ width: number(1, 16384), height: number(1, 16384) }),
  selection: object({
    clipId: nullable(numericId),
    textId: nullable(numericId),
    componentId: nullable(id),
    audioId: nullable(numericId),
  }),
  scenes: array(
    object(
      {
        id,
        name: string(120),
        parent: nullable(id),
        duration: time,
        muted: boolean,
        musicGain: gain,
        clipGain: gain,
        musicAnimation: animation,
        clips: array(
          object(
            {
              id: numericId,
              start: time,
              end: time,
              sourceIn: time,
              sourceOut: time,
              sourceDuration: time,
              speed: number(0.25, 4),
              zoom: number(0.5, 2),
              mirror: boolean,
              fit: enumeration(["cover", "contain"]),
              hasMedia: boolean,
              audioDetached: boolean,
              animation,
            },
            [
              "id",
              "start",
              "end",
              "sourceIn",
              "sourceOut",
              "sourceDuration",
              "speed",
              "zoom",
              "mirror",
              "fit",
              "hasMedia",
              "audioDetached",
            ],
          ),
          1000,
        ),
        texts: array(
          object(
            {
              id: numericId,
              ...textChanges,
              font: fontSummarySchema,
              animation,
            },
            ["id", "text", "start", "end", "x", "y"],
          ),
          500,
        ),
        audioClips: array(
          object(
            {
              id: numericId,
              name: string(120),
              start: time,
              end: time,
              sourceIn: time,
              sourceOut: time,
              sourceDuration: time,
              speed: number(0.25, 4),
              muted: boolean,
              gain,
              animation,
            },
            [
              "id",
              "name",
              "start",
              "end",
              "sourceIn",
              "sourceOut",
              "sourceDuration",
              "speed",
              "muted",
              "gain",
            ],
          ),
          500,
        ),
        components: array(
          object(
            {
              id,
              type: componentType,
              at: time,
              duration: nullable(time),
              x: position,
              y: position,
              scale: componentScale,
              scaleX: componentScale,
              scaleY: componentScale,
              proportionalScale: componentScale,
              width: componentPixels,
              height: componentPixels,
              label: string(),
              animation,
              font: fontSummarySchema,
              formFields: array(
                object({
                  name: { ...string(64), pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
                  kind: enumeration([
                    "name",
                    "email",
                    "phone",
                    "short",
                    "number",
                    "yesno",
                  ]),
                }),
                20,
              ),
              content: {
                type: "object",
                additionalProperties: string(),
                maxProperties: 20,
              },
              source: sourceSchema,
              design: sourceSchema,
              responsePolicy: responsePolicySchema,
            },
            [
              "id",
              "type",
              "at",
              "duration",
              "x",
              "y",
              "scale",
              "scaleX",
              "scaleY",
              "proportionalScale",
              "width",
              "height",
              "label",
              "content",
            ],
          ),
          500,
        ),
      },
      [
        "id",
        "name",
        "parent",
        "duration",
        "muted",
        "musicGain",
        "clipGain",
        "clips",
        "texts",
        "audioClips",
        "components",
      ],
    ),
    100,
  ),
});
// Receipts reuse the same public project fields; private media/source data is never accepted.
const sceneProperties = projectSchema.properties.scenes.items.properties;
const componentProperties = sceneProperties.components.items.properties;
const {
  source: _source,
  design: _design,
  ...componentReceiptProperties
} = componentProperties;
const entitySchemas = [
  object({
    kind: { const: "project" },
    values: object({ ratio, canvas: projectSchema.properties.canvas }),
  }),
  object({
    kind: { const: "scene" },
    sceneId: id,
    values: object(
      Object.fromEntries(
        [
          "id",
          "name",
          "parent",
          "duration",
          "muted",
          "musicGain",
          "clipGain",
          "musicAnimation",
        ].map((key) => [key, sceneProperties[key]]),
      ),
      ["id", "name", "parent", "duration", "muted", "musicGain", "clipGain"],
    ),
  }),
  ...[
    ["clip", "clips"],
    ["text", "texts"],
    ["audio", "audioClips"],
  ].map(([kind, collection]) =>
    object({
      kind: { const: kind },
      sceneId: id,
      values: sceneProperties[collection].items,
    }),
  ),
  object({
    kind: { const: "component" },
    sceneId: id,
    values: object(
      { ...componentReceiptProperties, sourceFingerprint: string(128) },
      [...sceneProperties.components.items.required, "sourceFingerprint"],
    ),
  }),
];
const entityState = { anyOf: entitySchemas };
const entityReference = {
  anyOf: [
    object({ kind: { const: "project" } }),
    object({ kind: { const: "scene" }, sceneId: id }),
    object({
      kind: enumeration(["clip", "text", "audio"]),
      sceneId: id,
      id: numericId,
    }),
    object({ kind: { const: "component" }, sceneId: id, id }),
  ],
};
const scheduledEffectSchema = {
  anyOf: operationSchemas.filter(
    (schema) =>
      schema.properties.kind.const.startsWith("playback.") ||
      schema.properties.kind.const === "export.prepare",
  ),
};
const receiptSchema = object(
  {
    operation: enumeration(
      operationSchemas.map((schema) => schema.properties.kind.const),
    ),
    target: nullable(entityReference),
    outcome: enumeration(["prepared", "unchanged", "scheduled"]),
    changes: array(
      object({ before: nullable(entityState), after: nullable(entityState) }),
      10000,
    ),
    effect: scheduledEffectSchema,
  },
  ["operation", "target", "outcome", "changes"],
);
const executionSchema = object({
  requestStartFingerprint: string(128),
  requestStartValues: array(
    object({ entity: entityReference, state: nullable(entityState) }),
    10000,
  ),
  receipts: array(receiptSchema, 144),
});
const observationSchema = {
  anyOf: [
    ...webObservations,
    operation("object_tracking", {
      id,
      ...scene,
      clipId: numericId,
      start: time,
      end: time,
      model: { const: "sam3.1" },
      frameCount: { type: "integer", minimum: 1, maximum: 151 },
      samples: array(
        object({
          time,
          visible: boolean,
          x: gain,
          y: gain,
          width: gain,
          height: gain,
          score: gain,
        }),
        151,
      ),
    }),
    operation("frames", {
      ...scene,
      start: time,
      end: time,
      frames: array(
        object({
          sceneTime: time,
          clipId: nullable(numericId),
          sourceTime: nullable(time),
          dataUrl: {
            ...string(800000),
            pattern: "^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$",
          },
          width: number(1, 1280),
          height: number(1, 1280),
        }),
        6,
      ),
      coverage: { const: "video-and-text" },
      note: string(),
    }),
    operation(
      "transcript",
      {
        ...scene,
        start: time,
        end: time,
        text: string(20000),
        segments: array(
          object({ start: time, end: time, text: string(2000) }),
          300,
        ),
      },
      ["sceneId", "start", "end", "text"],
    ),
    operation("word_timing", {
      ...scene,
      start: time,
      end: time,
      source: alignmentSource,
      sourceStart: time,
      sourceEnd: time,
      text: string(4000),
      words: array(
        object({
          text: string(200),
          start: time,
          end: time,
          sourceStart: time,
          sourceEnd: time,
        }),
        300,
      ),
      provenance: alignmentProvenance,
    }),
    operation("unavailable", {
      ...scene,
      requestedKind: enumeration([
        "frames",
        "transcript",
        "word_timing",
        "object_tracking",
      ]),
      message: string(),
    }),
  ],
};
export const nativeRequestSchema = object(
  {
    mode: enumeration(["ask", "plan", "edit"]),
    prompt: { ...string(4000), minLength: 1 },
    history: array(
      object({
        role: enumeration(["user", "assistant"]),
        content: string(8000),
      }),
      20,
    ),
    project: projectSchema,
    observations: array(observationSchema, 8),
    execution: executionSchema,
  },
  ["mode", "prompt", "history", "project", "observations"],
);
