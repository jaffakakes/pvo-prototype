import type { NativeProjectContext } from "../../../../../packages/pvo-assistant/native/index.js";
import { cloneAnimation } from "../../../../../packages/pvo-animation/index.js";
import { audioDuration } from "../../audio/editing";
import { audioGain } from "../../audio/gain";
import { dur } from "../../clips/timing";
import { fieldsShownFor } from "../../components/fields";
import { componentLanguageSource } from "../../components/languageCompilation";
import { componentLanguageModel } from "../../components/languageEditing";
import { responsePolicyFor } from "../../components/responsePolicy";
import { componentGestureScale, componentScale, componentSize } from "../../components/scale";
import { componentPixelDimension } from "../../../../../packages/pvo-component-runtime/index.js";
import { projectCanvasSize } from "../../project/ratio";
import { assistantLogicSource } from "../proposalPolicy";
import type { AssistantEvidence } from "../model";
import type { ProjectSnapshot } from "../../project/model";
import { sceneDuration } from "../../scenes/duration";

export function nativeValueFingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let first = 2166136261;
  let second = 5381;
  for (let at = 0; at < text.length; at += 1) {
    first = Math.imul(first ^ text.charCodeAt(at), 16777619);
    second = Math.imul(second, 33) ^ text.charCodeAt(at);
  }
  return `${text.length}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
}

/** The full comparison stays local; only this bounded change token crosses the wire. */
export function nativeProjectFingerprint(project: ProjectSnapshot): string {
  return nativeValueFingerprint(project);
}

/** Speech evidence survives visual edits, but never changes to its authored audio or timeline. */
export function nativeAudioFingerprint(project: ProjectSnapshot): string {
  return nativeValueFingerprint(project.scenes.map(scene => ({
    id: scene.id,
    muted: scene.muted,
    clipGain: audioGain(scene.clipGain),
    clips: scene.clips.map(clip => ({
      id: clip.id, url: clip.url, sourceDuration: clip.srcDur, sourceIn: clip.in, sourceOut: clip.out,
      speed: clip.speed, audioDetached: clip.audioDetached ?? false,
      gainAnimation: clip.animation?.tracks.gain,
    })),
    audioClips: (scene.audioClips ?? []).map(clip => ({
      id: clip.id, url: clip.url, sourceDuration: clip.srcDur, sourceIn: clip.in, sourceOut: clip.out,
      start: clip.start, speed: clip.speed, muted: clip.muted, gain: audioGain(clip.gain),
      gainAnimation: clip.animation?.tracks.gain,
    })),
  })));
}

export function nativeEvidenceFingerprint(project: ProjectSnapshot, scope: AssistantEvidence["scope"]): string {
  return scope === "audio" ? nativeAudioFingerprint(project) : nativeProjectFingerprint(project);
}

export function nativeEvidenceMatchesProject(evidence: AssistantEvidence, project: ProjectSnapshot): boolean {
  return evidence.fingerprint === nativeEvidenceFingerprint(project, evidence.scope);
}

/** Explicit projection prevents asset URLs, archived drafts and request payloads leaving the editor. */
export function nativeProjectContext(
  project: ProjectSnapshot, playhead: number,
  selection: NativeProjectContext["selection"] = { clipId: null, textId: null, componentId: null, audioId: null },
): NativeProjectContext {
  return {
    fingerprint: nativeProjectFingerprint(project), currentSceneId: project.currentSceneId,
    playhead, ratio: project.ratio, canvas: projectCanvasSize(project.ratio), selection: { ...selection },
    scenes: project.scenes.map(scene => {
      let start = 0;
      return {
        id: scene.id, name: scene.name, parent: scene.parent, duration: sceneDuration(scene),
        muted: scene.muted, musicGain: scene.musicGain ?? 1, clipGain: scene.clipGain ?? 1,
        ...(scene.musicAnimation ? { musicAnimation: cloneAnimation(scene.musicAnimation) } : {}),
        clips: scene.clips.map(clip => {
          const from = start;
          start += dur(clip);
          return { id: clip.id, start: from, end: start, sourceIn: clip.in, sourceOut: clip.out,
            sourceDuration: clip.srcDur, speed: clip.speed, zoom: clip.zoom, mirror: clip.mirror,
            fit: clip.fit, hasMedia: Boolean(clip.url), audioDetached: clip.audioDetached ?? false,
            ...(clip.animation ? { animation: cloneAnimation(clip.animation) } : {}) };
        }),
        texts: scene.texts.map(text => {
          const { fontAsset, ...style } = text.style ?? {};
          return { id: text.id, text: text.text, start: text.start, end: text.end,
            x: text.x, y: text.y, ...(text.style ? { style } : {}),
            ...(fontAsset ? { font: { id: fontAsset.id, family: fontAsset.family } } : {}),
            ...(text.animation ? { animation: cloneAnimation(text.animation) } : {}) };
        }),
        audioClips: (scene.audioClips ?? []).map(clip => ({ id: clip.id, name: clip.name,
          start: clip.start, end: clip.start + audioDuration(clip), sourceIn: clip.in, sourceOut: clip.out,
          sourceDuration: clip.srcDur, speed: clip.speed, muted: clip.muted, gain: clip.gain ?? 1,
          ...(clip.animation ? { animation: cloneAnimation(clip.animation) } : {}) })),
        components: scene.components.map(component => {
          const fields = fieldsShownFor(component);
          const content: Record<string, string> = {};
          for (const key of ["text", "title", "body", "prompt", "heading", "submitLabel"] as const) {
            const value = fields[key];
            if (value !== undefined) content[key] = value;
          }
          fields.buttons?.forEach((button, index) => { content[`button${index}`] = button.label; });
          fields.options?.forEach((option, index) => { content[`option${index}`] = option.label; });
          const model = componentLanguageModel(component);
          const hasRequests = model.rules.some(rule => rule.action.kind === "request");
          const design = componentLanguageSource(component);
          const axes = componentSize(component);
          const values = { id: component.id, at: component.at, duration: component.dur,
            ...(component.font ? { font: { id: component.font.id, family: component.font.family } } : {}),
            ...(model.structure.type === "form"
              ? { formFields: model.structure.fields.map(({ name, kind }) => ({ name, kind })) } : {}),
            x: component.x, y: component.y, label: fields.title || fields.prompt || fields.heading || fields.text || component.type,
            scale: componentScale(component.scale), scaleX: axes.width, scaleY: axes.height,
            proportionalScale: componentGestureScale(component),
            width: componentPixelDimension(component.width) ?? null, height: componentPixelDimension(component.height) ?? null,
            ...(component.animation ? { animation: cloneAnimation(component.animation) } : {}),
            content, ...(!component.code?.pvoTouched
              ? hasRequests ? { design: { structure: design.structure, style: design.style,
                logic: assistantLogicSource(model.rules.map(rule => ({ ...rule, action: { kind: "continue" } }))) } } : { source: design }
              : {}) };
          return component.type === "tooltip"
            ? { ...values, type: component.type }
            : { ...values, type: component.type, responsePolicy: { ...responsePolicyFor(component) } };
        }),
      };
    }),
  };
}
