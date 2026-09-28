import { useEffect, useState } from "react";
import { compilePvoComponent, PvoLanguageError } from "../../../../../packages/pvo-language/index.js";
import { componentLanguageSource, validateEditableLanguage } from "../../../domain/components/languageCompilation";
import type { PvoLanguageSource } from "../../../domain/components/languageSource";
import type { PvoComponent } from "../../../domain/project/model";
import { acceptComponentCompilation } from "../../../state/components/componentLanguageCommands";

export type LanguageFeedback =
  | { state: "checking" }
  | { state: "valid" }
  | { state: "invalid"; part: keyof PvoLanguageSource | null; message: string };

/** Owned by the sheet so switching between Fields and Advanced never cancels synchronization. */
export function usePvoCompilation(component: PvoComponent | undefined): LanguageFeedback {
  const [result, setResult] = useState<{
    componentId: string;
    componentType: PvoComponent["type"];
    source: PvoLanguageSource;
    feedback: LanguageFeedback;
  } | null>(null);
  const source = component && componentLanguageSource(component);

  useEffect(() => {
    if (!component || !source) return;
    let active = true;
    const setFeedback = (feedback: LanguageFeedback) => setResult({
      componentId: component.id, componentType: component.type, source, feedback,
    });
    setFeedback({ state: "checking" });
    const timer = window.setTimeout(() => {
      compilePvoComponent(component.type, source)
        .then(compiled => {
          if (!active) return;
          validateEditableLanguage(compiled);
          acceptComponentCompilation(component, compiled);
          setFeedback({ state: "valid" });
        })
        .catch((error: unknown) => {
          if (!active) return;
          setFeedback(error instanceof PvoLanguageError ? {
            state: "invalid",
            part: error.part,
            message: `${error.part[0].toUpperCase()}${error.part.slice(1)} · line ${error.diagnostic.line}: ${error.diagnostic.message}`,
          } : {
            state: "invalid", part: null,
            message: error instanceof Error ? error.message : "The PVO language compiler could not run.",
          });
        });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [component?.id, component?.type, component?.fields, component?.code?.pvoLiteral,
    source?.structure, source?.style, source?.logic]);

  const current = result?.componentId === component?.id && result?.componentType === component?.type
    && result?.source.structure === source?.structure && result?.source.style === source?.style
    && result?.source.logic === source?.logic;
  return current && result ? result.feedback : { state: "checking" };
}
