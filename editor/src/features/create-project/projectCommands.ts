import { saveProjectBeforeUpdate } from "../../app/projectAutosave";
import { navigateProject } from "../../app/navigation";
import { projectName } from "../../domain/project/creation";
import type { Clip, Ratio } from "../../domain/project/model";
import { templateProject, type ProjectTemplate } from "../../domain/project/templates";
import { mainScene } from "../../domain/scenes/rules";
import { uid } from "../../infrastructure/ids";
import { useCapture } from "../../state/captureStore";
import { setAdvancedEditingEnabled } from "../../state/preferences/editorPreferences";

type NewProject = { name: string; ratio: Ratio; clips: Clip[]; template?: ProjectTemplate };
let starting = false;

export async function createProject(input: NewProject, onCreated: () => void = () => {}) {
  if (starting) return false;
  starting = true;
  try {
    // Preserve the previous project and its media before replacing the workspace.
    await saveProjectBeforeUpdate();
    const project = input.template && input.clips[0]
      ? templateProject(input.template, input.clips[0], uid)
      : { scenes: [{ ...mainScene(), clips: input.clips }], currentSceneId: "main", ratio: input.ratio, allowedDomains: [] };
    const id = crypto.randomUUID();
    useCapture.getState().reset();
    useCapture.getState().patch({
      ...project, localId: id, projectName: projectName(input.name), screen: "editor",
      clips: project.scenes[0].clips, texts: project.scenes[0].texts, components: project.scenes[0].components,
    });
    if (input.template) setAdvancedEditingEnabled(true);
    onCreated();
    try { await saveProjectBeforeUpdate(); }
    catch (error) {
      // Keep the new project open with the existing retained save issue and Retry.
      console.error("New project is open but browser saving needs attention:", error);
    }
    navigateProject(id);
    return true;
  } finally { starting = false; }
}

export function resumeProject() {
  const state = useCapture.getState();
  const id = state.localId ?? crypto.randomUUID();
  state.patch({ localId: id, screen: "editor" });
  navigateProject(id);
}

export function showCreateProject() {
  const state = useCapture.getState();
  if (state.recording || state.importing || state.ex === "running") return;
  state.patch({ playing: false, sheet: null, orb: false });
  navigateProject(null);
}
