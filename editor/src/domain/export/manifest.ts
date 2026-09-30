import { sceneDuration } from "../audio/editing";
import { type CompiledPvoComponent, type PvoLanguageSource } from "../../../../packages/pvo-language/index.js";
import type { PvoComponent as ManifestComponent, PvoManifest } from "../../../../packages/pvo-sdk/index.js";
import { PVO_SPEC_VERSION } from "../../../../packages/pvo-sdk/index.js";
import { dur } from "../clips/timing";
import { actionFor, collectRequestDomains, requestHost } from "../components/actions";
import { responsePolicyFor } from "../components/responsePolicy";
import { componentScale, componentSize } from "../components/scale";
import { componentPixelDimension, type ComponentDimensions } from "../../../../packages/pvo-component-runtime/index.js";
import { formFieldControls, formSubmissionOutcome, validateFormFields } from "../components/forms";
import { cloneLook } from "../components/look";
import { layerOrder } from "../layers/order";
import type { Outcome, ProjectSnapshot, PvoComponent, Scene } from "../project/model";
import { clamp } from "../project/numbers";
import { projectRatio, projectCanvasSize } from "../project/ratio";

type CompiledLanguage = {
  source: PvoLanguageSource;
  compiled: CompiledPvoComponent;
};
export type CompiledLanguages = Map<string, CompiledLanguage>;
function ruleOutcome(language: CompiledLanguage, controlId: string | null): Outcome {
  const rule = language.compiled.rules.find((item) => item.target === controlId);
  if (!rule)
    throw new Error(`PVO Logic has no action for ${controlId ?? "submit"}.`);
  return rule.action;
}
function endOfClipAt(scene: Scene, at: number) {
  let end = 0;
  for (const clip of scene.clips) {
    end += dur(clip);
    if (at < end - .001)
      return end;
  }
  return sceneDuration(scene);
}
function assertOutcome(outcome: Outcome | undefined, scene: Scene, available: Set<string>) {
  if (outcome?.kind === "request") {
    assertOutcome(outcome.onSuccess, scene, available);
    if (outcome.onError)
      assertOutcome(outcome.onError, scene, available);
  }
  if (outcome?.kind === "scene" && !available.has(outcome.sceneId)) {
    throw new Error(`${scene.name} links to an empty or missing scene. Add a clip there before exporting.`);
  }
  if (outcome?.kind === "time" && (!Number.isFinite(outcome.t) || outcome.t < 0 || outcome.t > sceneDuration(scene))) {
    throw new Error(`${scene.name} has a jump outside its video. Choose a time in that scene.`);
  }
}
function manifestComponent(component: PvoComponent, scene: Scene, available: Set<string>, languages: CompiledLanguages, canvas: ComponentDimensions): ManifestComponent {
  // Visual forms use native manifest controls; code-owned forms use compiled source.
  const visualForm = component.type === "form" && !component.code?.custom && !!component.fields.formFields;
  const visualLook = !component.code?.custom && !!component.look;
  const language = visualForm || visualLook ? undefined : languages.get(component.id);
  if (component.code?.custom && !language) {
    throw new Error(`${scene.name} · ${component.type}: compile PVO language before building the manifest.`);
  }
  const length = sceneDuration(scene);
  const at = clamp(component.at, 0, Math.max(0, length - .01));
  const end = Math.min(length, component.dur == null ? endOfClipAt(scene, at) : at + Math.max(.5, component.dur));
  const scale = componentScale(component.scale);
  const size = componentSize(component);
  const pixelWidth = componentPixelDimension(component.width);
  const pixelHeight = componentPixelDimension(component.height);
  const boxWidth = Math.min(1, pixelWidth === undefined
    ? (component.type === "tooltip" ? .5 : component.type === "choice" ? .71 : .77) * size.width : pixelWidth * scale / canvas.width);
  const boxHeight = Math.min(1, pixelHeight === undefined
    ? (component.type === "tooltip" ? .08 : component.type === "choice" ? .4 : .38) * size.height : pixelHeight * scale / canvas.height);
  const presentation = {
    scene: scene.id,
    start: at,
    end: Math.max(at + .001, end),
    x: clamp(component.x / 100 - boxWidth / 2, 0, 1 - boxWidth),
    y: clamp(component.y / 100 - boxHeight / 2, 0, 1 - boxHeight),
    width: boxWidth,
    height: boxHeight,
  };
  let outcomes: Outcome[] = [];
  const fields = component.fields;
  const structure = language?.compiled.structure;
  const responsePolicy = component.type === "tooltip" ? undefined : responsePolicyFor(component);
  const result: ManifestComponent = component.type === "tooltip"
    ? { id: component.id, kind: "tooltip", presentation }
    : {
        id: component.id,
        kind: component.type,
        presentation,
        response_policy: { ...responsePolicy! },
      };
  if (component.type === "tooltip") {
    result.text = structure?.type === "tooltip" ? structure.text : fields.text || "";
  }
  else if (component.type === "card") {
    result.title = structure?.type === "card" ? structure.title || "" : fields.title || "";
    result.text = structure?.type === "card" ? structure.body || "" : fields.body || "";
    const buttons = structure?.type === "card" ? structure.buttons : (fields.buttons || []).slice(0, 2);
    if (!buttons.length && responsePolicy?.unanswered === "pause") {
      throw new Error(`${scene.name} · Message: add a button or turn off Pause if nobody responds.`);
    }
    outcomes = buttons.map((button, index) => language
      ? ruleOutcome(language, "id" in button ? button.id : null)
      : fields.buttons?.[index]?.outcome || { kind: "continue" });
    result.actions = buttons.map((button, index) => ({ label: button.label, action: actionFor(outcomes[index], component.id) }));
  }
  else if (component.type === "choice") {
    result.title = structure?.type === "choice" ? structure.prompt : fields.prompt || "";
    const options = structure?.type === "choice" ? structure.options : [0, 1].map(index => fields.options?.[index] ?? {
      label: `Option ${String.fromCharCode(65 + index)}`,
      outcome: { kind: "continue" } as Outcome,
    });
    outcomes = options.map((option, index) => language
      ? ruleOutcome(language, "id" in option ? option.id : null)
      : fields.options?.[index]?.outcome || { kind: "continue" });
    result.options = options.map((option, index) => ({
      label: option.label,
      action: actionFor(outcomes[index], component.id),
    }));
  }
  else if (component.type === "form") {
    if (visualForm) {
      validateFormFields(fields.formFields!);
      result.title = fields.heading ?? "";
      result.fields = formFieldControls(fields).map(field => ({
        name: field.name, label: field.label,
        type: field.type === "yesno" ? "choice" : field.type,
        ...(field.type === "yesno" ? { options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }] } : {}),
      }));
      result.submit_label = fields.submitLabel || "Send";
      const submission = formSubmissionOutcome(component);
      outcomes = [submission ?? fields.failureOutcome ?? { kind: "continue" }];
      result.on_submit = submission ? actionFor(submission, component.id)
        : fields.failureOutcome ? actionFor(fields.failureOutcome) : { type: "chain", actions: [] };
    }
    else {
      const labels = { name: "Name", email: "Email", phone: "Phone", short: "Short text", number: "Number", yesno: "Yes or no" };
      const formFields = structure?.type === "form" ? structure.fields : (fields.fieldKinds || []).map((kind, index) => ({ kind, name: `${kind}_${index}` }));
      result.title = structure?.type === "form" ? structure.heading ?? "" : fields.heading ?? "";
      result.fields = formFields.map(field => ({
        name: field.name,
        label: "label" in field && typeof field.label === "string" ? field.label : labels[field.kind],
        type: field.kind === "email" ? "email" as const : field.kind === "number" ? "number" as const : field.kind === "yesno" ? "choice" as const : "text" as const,
        ...(field.kind === "yesno" ? { options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }] } : {}),
      }));
      result.submit_label = structure?.type === "form" ? structure.submit : fields.submitLabel || "Send";
      outcomes = [language ? ruleOutcome(language, null) : fields.outcome || { kind: "continue" }];
      result.on_submit = actionFor(outcomes[0], component.id);
    }
  }
  outcomes.forEach((outcome) => assertOutcome(outcome, scene, available));
  result.restyle_capture = {
    version: 1,
    at,
    dur: component.dur,
    x: component.x,
    y: component.y,
    scale,
    ...(pixelWidth === undefined ? {} : { width: pixelWidth }),
    ...(pixelHeight === undefined ? {} : { height: pixelHeight }),
    ...(component.scaleX === undefined ? {} : { scaleX: size.width }),
    ...(component.scaleY === undefined ? {} : { scaleY: size.height }),
    ...(component.look ? { look: cloneLook(component.look) } : {}),
    outcomes,
    ...(visualForm ? { form: {
      ...(fields.formSubmitMode ? { submitMode: fields.formSubmitMode } : {}),
      heading: fields.heading ?? "", destination: fields.destination ?? "", waitingLabel: fields.waitingLabel || "Sending…",
      fields: formFieldControls(fields).map(({ name, label, type }) => ({ name, label, type })),
      successOutcome: fields.successOutcome ?? { kind: "continue" }, failureOutcome: fields.failureOutcome ?? null,
    } } : {}),
    ...(component.type === "card" ? { buttons: (structure?.type === "card" ? structure.buttons : (fields.buttons || []).slice(0, 2)).map((button) => ({ label: button.label })) } : {}),
    ...(language ? { code: { language: {
          version: 1,
          structure: `components/${component.id}/structure.pvo`,
          style: `components/${component.id}/style.pvo`,
          logic: `components/${component.id}/logic.pvo`,
        } } } : {}),
  };
  return result;
}
export function buildPvoManifest(state: ProjectSnapshot, rendered: Array<{
  scene: Scene;
  assetId: string;
  name: string;
  type: string;
}>, languages: CompiledLanguages = new Map()): PvoManifest {
  if (!rendered.length)
    throw new Error("Record or upload a clip before exporting.");
  const entry = state.scenes.find(scene => scene.id === "main");
  if (!entry || !rendered.some(({ scene }) => scene.id === entry.id)) {
    throw new Error("Add a clip to Main before exporting an interactive video.");
  }
  const available = new Set(rendered.map(({ scene }) => scene.id));
  const missing = state.scenes.find(scene => !available.has(scene.id));
  if (missing) {
    throw new Error(`Add a clip to ${missing.name} before exporting the whole scene tree.`);
  }
  const allowedDomains = new Set(collectRequestDomains(state.scenes, state.allowedDomains, false));
  for (const { compiled } of languages.values())
    for (const rule of compiled.rules) {
      if (rule.action.kind === "request")
        allowedDomains.add(requestHost(rule.action.url));
    }
  const [width, height] = projectRatio(state.ratio);
  return {
    spec_version: PVO_SPEC_VERSION,
    title: "Restyle video",
    initial_scene: entry.id,
    allowed_domains: [...allowedDomains],
    canvas: { ratio: state.ratio, width, height },
    restyle_capture: { version: 1, scene_layers: Object.fromEntries(rendered.map(({ scene }) => [scene.id, { order: layerOrder(scene), texts: scene.texts }])) },
    media: rendered.map(({ scene, assetId, name, type }) => ({ id: `media-${scene.id}`, asset_id: assetId, name, type })),
    scenes: rendered.map(({ scene, assetId }) => ({
      id: scene.id,
      label: scene.name,
      parent: scene.id === "main" ? null : scene.parent ?? "main",
      asset_id: assetId,
      start: 0,
      end: sceneDuration(scene),
    })),
    playback: {
      initial_timeline: `timeline-${entry.id}`,
      timelines: rendered.map(({ scene, assetId }) => ({
        id: `timeline-${scene.id}`,
        kind: scene.id === entry.id ? "main" : "branch",
        clips: [{ id: `clip-${scene.id}`, asset_id: assetId, scene: scene.id, start: 0, end: sceneDuration(scene) }],
      })),
    },
    components: rendered.flatMap(({ scene }) => scene.components.map((component) => manifestComponent(component, scene, available, languages, projectCanvasSize(state.ratio)))),
  };
}
