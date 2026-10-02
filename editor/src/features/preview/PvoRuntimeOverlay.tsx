import { useEffect,useRef,useState } from "react";
import { mountCustomComponent } from "../../../../packages/pvo-code-runtime/index.js";
import { compilePvoComponent,isPvoLanguageActionAllowed } from "../../../../packages/pvo-language/index.js";
import { resolveLanguageSource,validateEditableLanguage } from "../../domain/components/languageCompilation";
import { type Clip,type PvoComponent } from "../../domain/project/model";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { runComponentResponse, observeTryDiagnostics } from "./tryMode";
import { sourceRevision } from "../../domain/debugging/components";
import { useTryFeedback } from "./tryFeedbackStore";
import { useTryRuntimeState } from "./tryRuntimeStateStore";
import feedbackStyles from "./PreviewFeedback.module.css";

const EMPTY_RUNTIME_STATE: Record<string, unknown> = {};
let rendererSerial = 0;

function submittedFields(input: unknown, names: { name: string; kind: string; label?: string }[], modern: boolean) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Form submission must contain fields.");
  const supplied = input as Record<string, unknown>;
  const declared = new Set(names.map(field => field.name));
  if (Object.keys(supplied).some(key => !declared.has(key))) throw new Error("Form submitted an undeclared field.");
  return Object.fromEntries(names.map(field => {
    const value = supplied[field.name];
    if (field.kind === "yesno") return [field.name, modern ? value === "on" : value === "on" ? "yes" : "no"];
    if (value !== undefined && typeof value !== "string") throw new Error("Form fields must be text.");
    if (field.kind === "number" && String(value ?? "").trim()) {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`Enter a number for ${field.label ?? field.name}.`);
      return [field.name, number];
    }
    return [field.name, String(value ?? "").slice(0, 500)];
  }));
}

export function PvoRuntimeOverlay({ component, width, trying, isVisible }: {
  component: PvoComponent;
  width: number;
  trying: boolean;
  isVisible: (component: PvoComponent, clips: Clip[], t: number, holdingId: string | null) => boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<ReturnType<typeof mountCustomComponent> | null>(null);
  const [contentSize, setContentSize] = useState({ width: 247, height: 220 });
  const [failure, setFailure] = useState<string | null>(null);
  const source = component.code?.pvoTouched && component.code.pvoLastValid
    ? component.code.pvoLastValid : component.code?.pvo;
  const pending = useTryFeedback(state => state.components[component.id]?.phase === "pending");
  const runtimeState = useTryRuntimeState(state => trying && component.type === "tooltip" ? state.value : null);
  const templateState = trying && component.type === "tooltip" ? runtimeState ?? EMPTY_RUNTIME_STATE : undefined;
  const templateStateRef = useRef<Record<string, unknown> | undefined>(templateState);
  templateStateRef.current = templateState;

  useEffect(() => () => { runtime.current?.destroy(); runtime.current = null; }, []);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    // The absolute host sizes itself from the runtime's fitted render shell.
    // Measure before transforms so shell sizing cannot feed back into this observer.
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      setContentSize(previous => previous.width === width && previous.height === height
        ? previous : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!host.current || !component.code?.custom || !source) return;
    let cancelled = false;
    const observe = observeTryDiagnostics();
    const rendererId = ++rendererSerial;
    const identity = { componentId: component.id, sceneId: component.sceneId,
      source: { revision: sourceRevision(component), lastValid: !!(component.code.pvoTouched && component.code.pvoLastValid) } };
    const inputId = (eventId?: number) => eventId == null ? undefined : `renderer:${rendererId}:input:${eventId}`;
    setFailure(null);
    const reportRuntimeError = (error: unknown) => {
      if (cancelled) return;
      console.error(`PVO preview failed for component ${component.id}:`, error);
      setFailure(error instanceof Error ? error.message : "The component could not be rendered.");
      if (trying) observe({ ...identity, type: "component.failed", reason: "start_error", message: error instanceof Error ? error.message : String(error) });
    };
    const render = async () => {
      try {
        const compiled = await compilePvoComponent(component.type, resolveLanguageSource(component, source));
        if (cancelled || !host.current) return;
        validateEditableLanguage(compiled);
        runtime.current?.destroy();
        runtime.current = mountCustomComponent(host.current, {
          html: compiled.html,
          css: compiled.css,
          js: compiled.js,
          fields: {},
          state: templateStateRef.current,
          componentId: component.id,
          maxWidth: 247,
          maxHeight: 285,
          interactive: trying,
          onDiagnostic: event => {
            if (!trying || cancelled || event.type === "action.started" || event.type === "action.completed") return;
            const hasAction = compiled.structure.type === "tooltip" || compiled.rules.length > 0;
            observe({ ...identity, type: event.type, interactionId: inputId(event.eventId),
              reason: event.type === "component.ready" ? hasAction ? "action_assigned" : "no_matching_rule" : event.reason, target: event.target });
            if (event.type === "component.ready" && !hasAction)
              observe({ ...identity, type: "component.no_action", reason: "no_matching_rule" });
          },
          onAction: ({ method, args }, diagnostic) => {
            const interactionId = inputId(diagnostic?.eventId);
            const state = useCapture.getState();
            const active = state.components.find(item => item.id === component.id);
            if (!state.tryMode || !active || active.sceneId !== state.currentSceneId ||
                !isVisible(active, state.clips, state.t, state.tryMode.holdingId)) {
              observe({ ...identity, type: "interaction.ignored", interactionId, reason: "inactive_component" });
              return;
            }
            if (!isPvoLanguageActionAllowed(active.type, method))
              throw new Error(`PVO ${active.type} cannot use that action.`);

            if (method === "pick") {
              const controls = compiled.structure.type === "choice" ? compiled.structure.options
                : compiled.structure.type === "card" ? compiled.structure.buttons : null;
              const index = Number(args[0]);
              if (!controls || !Number.isInteger(index) || index < 0 || index >= controls.length) {
                observe({ ...identity, type: "interaction.ignored", interactionId, reason: "invalid_control" });
                return;
              }
              const rule = compiled.rules.find(item => item.target === controls[index].id);
              if (rule) void runComponentResponse(active, { index, outcome: rule.action }, interactionId);
              else observe({ ...identity, type: "interaction.ignored", interactionId, reason: "no_matching_rule", target: controls[index].label });
              return;
            }

            if (method === "submit" && compiled.structure.type === "form") {
              const modern = compiled.structure.heading !== undefined || compiled.structure.waiting !== undefined || compiled.structure.fields.some(field => field.label !== undefined || field.kind === "number");
              const fields = submittedFields(args[0], compiled.structure.fields, modern);
              const rule = compiled.rules.find(item => item.target === null);
              if (rule) return runComponentResponse(active, { index: 0, outcome: rule.action, formValues: fields }, interactionId);
              observe({ ...identity, type: "interaction.ignored", interactionId, reason: "no_matching_rule", target: compiled.structure.submit });
            }
          },
          onError: reportRuntimeError,
        });
      } catch (error) {
        if (!cancelled) reportRuntimeError(error);
      }
    };
    const timer = window.setTimeout(() => { void render(); }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [component.id, component.type, component.fields, component.code?.custom, component.code?.pvoLiteral, source, trying, isVisible]);

  useEffect(() => { runtime.current?.setInteractive(trying); }, [trying]);
  useEffect(() => { runtime.current?.setPending(pending); }, [pending]);
  useEffect(() => { runtime.current?.update({ state: templateState }); }, [templateState]);
  const scale = width / 247;
  return <div className={cx("compCustomShell")} style={{ width: failure ? width : contentSize.width * scale, height: failure ? "auto" : contentSize.height * scale }}>
    <div className={cx("compCustomRuntime")} ref={host} style={{
      display: failure ? "none" : "inline-block", width: "max-content", height: "auto", transform: `scale(${scale})`,
    }} />
    {failure && <div className={feedbackStyles.failure}>
      <span>Preview unavailable.</span>
      <details><summary>Details</summary>{failure}</details>
    </div>}
  </div>;
}
