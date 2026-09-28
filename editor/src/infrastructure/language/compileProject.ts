import { compilePvoComponent } from "../../../../packages/pvo-language/index.js";
import { componentLanguageSource } from "../../domain/components/languageCompilation";
import type { CompiledLanguages } from "../../domain/export/manifest";
import type { ProjectSnapshot } from "../../domain/project/model";

export async function compileLanguages(state: Pick<ProjectSnapshot, "scenes">): Promise<CompiledLanguages> {
  const languages: CompiledLanguages = new Map();
  for (const scene of state.scenes)
    for (const component of scene.components) {
      if (component.code?.custom && !component.code.pvo) {
        throw new Error(`${scene.name} · ${component.type}: this older HTML/CSS/JavaScript component cannot be exported. Reset it to Fields or recreate it in PVO language.`);
      }
      const source = componentLanguageSource(component);
      const compiled = await compilePvoComponent(component.type, source);
      if (component.type === "choice" && compiled.structure.type === "choice" && compiled.structure.options.length !== 2) {
        throw new Error(`${scene.name} · Choice: use exactly two options in this editor.`);
      }
      languages.set(component.id, { source, compiled });
    }
  return languages;
}
