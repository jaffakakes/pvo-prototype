import type { Clip, ProjectSnapshot, Ratio, Scene } from "./model";
import { mainScene } from "../scenes/rules";
import { createLook } from "../components/look";

export type ProjectTemplate = {
  id: string;
  title: string;
  ratio: Ratio;
  scenes: number;
  interactive: boolean;
  color: string;
  caption: string;
};

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  { id: "talking-head", title: "Talking head", ratio: "9:16", scenes: 2, interactive: false, color: "#482b3d", caption: "Here's the story" },
  { id: "product-drop", title: "Product drop", ratio: "9:16", scenes: 3, interactive: false, color: "#203f34", caption: "Meet your new favourite" },
  { id: "choose-your-path", title: "Choose your path", ratio: "9:16", scenes: 3, interactive: true, color: "#2d2444", caption: "Where next?" },
  { id: "travel-recap", title: "Travel recap", ratio: "9:16", scenes: 5, interactive: false, color: "#51422a", caption: "A little escape" },
  { id: "podcast-clip", title: "Podcast clip", ratio: "1:1", scenes: 1, interactive: false, color: "#21414a", caption: "Let's talk about it" },
  { id: "tutorial", title: "Tutorial", ratio: "16:9", scenes: 3, interactive: false, color: "#3d2d23", caption: "Let's make something" },
];

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
  if (template.interactive) {
    scenes[0].components.push({
      id: `component-${nextId()}`, type: "choice", sceneId: "main", at: 2, dur: null, branchAtEnd: true,
      x: 50, y: 50, look: createLook("bold", 2),
      fields: { prompt: "Choose your path", options: [
        { label: "Explore", outcome: { kind: "scene", sceneId: scenes[1].id } },
        { label: "Discover", outcome: { kind: "scene", sceneId: scenes[2].id } },
      ] },
    });
  }
  return { scenes, currentSceneId: "main", ratio: template.ratio, allowedDomains: [] };
}
