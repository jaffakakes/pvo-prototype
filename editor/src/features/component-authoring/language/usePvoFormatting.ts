import { useCallback, useEffect, useRef, useState } from "react";
import { componentLanguageSource } from "../../../domain/components/languageCompilation";
import type { PvoComponent } from "../../../domain/project/model";
import { preparePvoFormatting } from "../../../infrastructure/language/formatSource";
import { useCapture } from "../../../state/captureStore";
import { useAssistant } from "../../../state/assistant/assistantStore";
import { acceptFormattedComponentSource } from "../../../state/components/componentLanguageCommands";

type SourceSnapshot = { id: string; source: string };
const snapshot = (component: PvoComponent): SourceSnapshot => ({
  id: component.id, source: JSON.stringify(componentLanguageSource(component)),
});

/** Format on entry and after leaving a changed field, never during typing. */
export function usePvoFormatting(component: PvoComponent | undefined, enabled: boolean, ready: boolean) {
  const entry = useRef<(SourceSnapshot & { done: boolean }) | null>(null);
  const pendingBlur = useRef<SourceSnapshot | null>(null);
  const edited = useRef(false);
  const operation = useRef(0);
  const alive = useRef(false);
  const [blurVersion, setBlurVersion] = useState(0);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; operation.current++; };
  }, []);

  const run = useCallback(async (input: PvoComponent, recordHistory: boolean) => {
    const token = ++operation.current;
    try {
      const result = await preparePvoFormatting(input.type, componentLanguageSource(input));
      if (!alive.current || token !== operation.current || useAssistant.getState().phase !== "idle") return;
      if (result) acceptFormattedComponentSource(input, result.source, result.compiled, recordHistory);
    } catch {
      // Formatting is optional; validation retains source and reports compiler failures.
    }
  }, []);

  useEffect(() => {
    if (!component) return;
    const current = snapshot(component);
    const pending = pendingBlur.current;
    if (pending && (pending.id !== current.id || pending.source !== current.source)) pendingBlur.current = null;
    if (pendingBlur.current && ready && useAssistant.getState().phase === "idle") {
      pendingBlur.current = null;
      void run(component, false);
      return;
    }
    if (!enabled) return;
    if (entry.current?.id !== component.id) entry.current = { ...current, done: false };
    if (entry.current.done) return;
    if (entry.current.source !== current.source || component.code?.pvoTouched || (component.code && !component.code.pvo)) {
      entry.current.done = true;
      return;
    }
    // Wait for initial compilation before taking the stale-edit guard's snapshot.
    if (!ready || useAssistant.getState().phase !== "idle") return;
    entry.current.done = true;
    void run(component, true);
  }, [component, enabled, ready, blurVersion, run]);

  const onEdit = () => {
    edited.current = true;
    pendingBlur.current = null;
    operation.current++;
  };
  const onBlur = () => {
    if (!edited.current) return;
    edited.current = false;
    const current = useCapture.getState().components.find(item => item.id === component?.id);
    if (!current) return;
    pendingBlur.current = snapshot(current);
    setBlurVersion(value => value + 1);
  };
  return { onEdit, onBlur };
}
