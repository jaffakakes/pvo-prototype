import type { Clip, ProjectSnapshot, PvoComponent, Ratio, Scene } from "./model";
import { mainScene } from "../scenes/rules";
import { createLook } from "../components/look";

export type TemplateHint = "caption" | "card" | "choice" | "route" | "jump" | "form";

type ProjectTemplateBase = {
  id: string;
  title: string;
  ratio: Ratio;
  scenes: number;
  posterColor: string;
  poster?: string;
  caption: string;
  hint: TemplateHint;
};

export type ProjectTemplate = ProjectTemplateBase & (
  | { interactive: false; duration: number; behaviour?: never }
  | { interactive: true; behaviour: string; duration?: never }
);

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  { id: "talking-head", title: "Talking head", ratio: "9:16", scenes: 2, duration: 30, interactive: false, posterColor: "#4A2A3E", caption: "Here's the story", hint: "caption" },
  { id: "product-drop", title: "Product drop", ratio: "9:16", scenes: 3, interactive: true, behaviour: "Message actions", posterColor: "#1F3D33", caption: "Meet your new favourite", hint: "card" },
  { id: "choose-your-path", title: "Choose your path", ratio: "9:16", scenes: 3, interactive: true, behaviour: "Choice branching", posterColor: "#2B2347", caption: "Where next?", hint: "choice" },
  { id: "travel-recap", title: "Travel recap", ratio: "9:16", scenes: 5, interactive: true, behaviour: "Scene routing", posterColor: "#4A3B23", caption: "A little escape", hint: "route" },
  { id: "podcast-clip", title: "Podcast clip", ratio: "1:1", scenes: 1, interactive: true, behaviour: "Timeline jump", posterColor: "#23404A", caption: "Let's talk about it", hint: "jump" },
  { id: "tutorial", title: "Tutorial", ratio: "16:9", scenes: 3, interactive: true, behaviour: "Local form", posterColor: "#3A2A1F", caption: "Let's make something", hint: "form" },
];

function componentBase(type: PvoComponent["type"], duration: number, nextId: () => number) {
  return {
    id: `component-${nextId()}`,
    type,
    sceneId: "main",
    at: Math.min(1, Math.max(0, duration - .1)),
    dur: null,
    x: 50,
    y: type === "tooltip" ? 28 : 50,
  } as const;
}

/** Each starter demonstrates a distinct valid Structure, Style and Logic combination. */
function sampleComponent(template: ProjectTemplate, scenes: readonly Scene[], duration: number, nextId: () => number): PvoComponent {
  if (template.hint === "caption") return {
    ...componentBase("tooltip", duration, nextId),
    look: createLook("soft", 0),
    fields: { text: "A clear takeaway goes here" },
  };
  if (template.hint === "card") return {
    ...componentBase("card", duration, nextId),
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    look: createLook("bold", 2),
    fields: {
      title: "The new drop",
      body: "Use buttons to control playback.",
      buttons: [
        { label: "Replay", outcome: { kind: "time", t: 0 } },
        { label: "Keep watching", outcome: { kind: "continue" } },
      ],
    },
  };
  if (template.hint === "choice") return {
    ...componentBase("choice", duration, nextId),
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    look: createLook("bold", 2),
    fields: { prompt: "Choose your path", options: [
      { label: "Explore", outcome: { kind: "scene", sceneId: scenes[1].id } },
      { label: "Discover", outcome: { kind: "scene", sceneId: scenes[2].id } },
    ] },
  };
  if (template.hint === "route") return {
    ...componentBase("card", duration, nextId),
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    look: createLook("minimal", 2),
    fields: {
      title: "Next stop",
      body: "Send viewers to another scene.",
      buttons: [
        { label: "Go there", outcome: { kind: "scene", sceneId: scenes[1].id } },
        { label: "Stay here", outcome: { kind: "continue" } },
      ],
    },
  };
  if (template.hint === "jump") return {
    ...componentBase("card", duration, nextId),
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    look: createLook("contrast", 2),
    fields: {
      title: "Jump to the highlight",
      body: "Seek within the current scene.",
      buttons: [
        { label: "Hear the highlight", outcome: { kind: "time", t: Math.min(3, duration * .6) } },
        { label: "Continue", outcome: { kind: "continue" } },
      ],
    },
  };
  return {
    ...componentBase("form", duration, nextId),
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    look: createLook("soft", 1),
    fields: {
      heading: "Quick check",
      formFields: [{ name: "What will you try?", type: "text" }],
      formSubmitMode: "local",
      submitLabel: "Continue",
      successOutcome: { kind: "continue" },
    },
  };
}

/** Templates are real editable scene structures. IDs and decoded media come from adapters. */
export function templateProject(template: ProjectTemplate, media: Clip, nextId: () => number): ProjectSnapshot {
  const scenes: Scene[] = Array.from({ length: template.scenes }, (_, index) => {
    const id = index === 0 ? "main" : `scene-${nextId()}`;
    const duration = Math.min(media.srcDur, 6);
    return {
      ...mainScene(), id, parent: index === 0 ? null : "main",
      name: index === 0 ? "Intro" : `Scene ${index + 1}`,
      clips: [{ ...media, id: nextId(), out: duration }],
      texts: [{ id: nextId(), text: index === 0 ? template.caption : `Your story, part ${index + 1}`,
        color: 2, start: 0, end: duration, x: 50, y: 72 }],
    };
  });
  scenes[0].components.push(sampleComponent(template, scenes, scenes[0].clips[0].out, nextId));
  return { scenes, currentSceneId: "main", ratio: template.ratio, allowedDomains: [] };
}
