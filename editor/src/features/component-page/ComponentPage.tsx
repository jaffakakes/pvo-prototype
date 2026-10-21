import { useEffect, useRef, useState } from "react";
import {
  isVisualEditingBlocked,
  restoreLastValidPvo,
} from "../../domain/components/codeOwnership";
import { fieldsShownFor } from "../../domain/components/fields";
import { lookParts, type LookPart } from "../../domain/components/look";
import type { PvoLanguageSource } from "../../domain/components/languageSource";
import type { PvoComponent } from "../../domain/project/model";
import { useCapture } from "../../state/captureStore";
import {
  selectComponentLookPart,
  selectComponentSourcePart,
} from "../../state/components/componentAuthoringStore";
import { setAdvancedEditingEnabled } from "../../state/preferences/editorPreferences";
import { useEditorTransition } from "../../ui/motion/EditorMotion";
import { useToolSwap } from "../../ui/motion/useToolSwap";
import { Icon } from "../../ui/Icon";
import { OrbAssistant } from "../assistant/OrbAssistant";
import { usePvoCompilation } from "../component-authoring/language/usePvoCompilation";
import { ComponentStage } from "./ComponentStage";
import { PageToolbar } from "./PageToolbar";
import { DesignPanel, type DesignTool } from "./design/DesignPanel";
import { LogicPanel } from "./logic/LogicPanel";
import { CodeSheet } from "./code/CodeSheet";
import styles from "./ComponentPage.module.css";

const MAIN_TOOLS = [
  { id: "words", label: "Text", icon: "textDesigns" },
  { id: "looks", label: "Style", icon: "palette" },
  { id: "layout", label: "Layout", icon: "crop" },
  { id: "fields", label: "Fields", icon: "fields" },
  { id: "code", label: "Code", icon: "code" },
];
const STYLE_TOOLS = [
  { id: "background", label: "Background", icon: "palette" },
  { id: "border", label: "Border", icon: "crop" },
  { id: "text", label: "Text", icon: "textDesigns" },
  { id: "corners", label: "Corners", icon: "components" },
];

export function ComponentPage({ component }: { component: PvoComponent }) {
  const transition = useEditorTransition();
  const sheetRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<"design" | "logic">("design");
  const [tool, setTool] = useState<DesignTool>(() =>
    isVisualEditingBlocked(component) ? "code" : "looks",
  );
  const [styleTools, setStyleTools] = useState(false);
  const [selectedPart, setPart] = useState<LookPart>("whole");
  const [control, setControl] = useState<number | null>(
    component.type === "tooltip" ? null : 0,
  );
  const [sourcePart, setSourcePart] =
    useState<keyof PvoLanguageSource>("structure");
  const [expanded, setExpanded] = useState(false);
  const [stageTarget, setStageTarget] = useState<HTMLDivElement | null>(null);
  const [codeTarget, setCodeTarget] = useState<HTMLDivElement | null>(null);
  const feedback = usePvoCompilation(component);
  const blocked = isVisualEditingBlocked(component);
  const fields = fieldsShownFor(component);
  const parts = lookParts(component);
  const part = parts.some((item) => item.id === selectedPart)
    ? selectedPart
    : "whole";
  const controls =
    component.type === "form"
      ? [{ label: fields.submitLabel || "Send" }]
      : component.type === "choice"
        ? (fields.options ?? [])
        : (fields.buttons ?? []);
  const selectedOutcome =
    component.type === "form"
      ? fields.outcome
      : (component.type === "choice" ? fields.options : fields.buttons)?.[
          control ?? 0
        ]?.outcome;
  const actionLabel =
    fields.formSubmitMode === "collect"
      ? "your inbox"
      : selectedOutcome?.kind === "time"
        ? `jump to ${selectedOutcome.t.toFixed(1)} s`
        : selectedOutcome?.kind === "scene"
          ? "another scene"
          : selectedOutcome?.kind === "request"
            ? "send a request"
            : "continue video";
  const selectedControl =
    control !== null && control < controls.length ? control : null;
  const code = tool === "code";
  useToolSwap(sheetRef, `${tab}:${tool}:${sourcePart}:${selectedControl}`);
  const selectPart = (value: LookPart) => {
    setPart(value);
    selectComponentLookPart(component.id, value);
    if (tab === "logic")
      setControl(value.startsWith("button:") ? Number(value.slice(7)) : null);
  };
  const openCode = (value: keyof PvoLanguageSource) => {
    setAdvancedEditingEnabled(true);
    selectComponentSourcePart(component.id, value);
    setSourcePart(value);
    setTool("code");
    setStyleTools(false);
    if (value === "logic") setTab("logic");
  };
  const close = () => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    transition(
      "component",
      () => useCapture.getState().patch({ sheet: null, playing: false }),
      "close",
    );
  };
  useEffect(() => {
    useCapture.getState().patch({ playing: false });
  }, []);
  const restore = restoreLastValidPvo(component);
  const onRestore = restore
    ? () => useCapture.getState().updateComponent(component.id, restore)
    : undefined;
  const logicTools = controls.map((item, index) => ({
    id: String(index),
    label: `${item.label} button`,
    icon: component.type === "choice" ? "choice" : "form",
  }));
  logicTools.push({
    id: "whole",
    label: `Whole ${component.type === "form" ? "form" : component.type === "tooltip" ? "note" : "component"}`,
    icon: "components",
  });
  return (
    <main
      className={styles.page}
      data-component-page
      data-code-expanded={code && expanded}
      aria-label="Component design page"
    >
      <header className={styles.header}>
        <button type="button" className={styles.videoButton} onClick={close}>
          <Icon name="back" size={15} />
          <span>Video</span>
        </button>
        <div
          className={styles.tabs}
          role="group"
          aria-label="Component workspace"
        >
          {(["design", "logic"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={tab === value}
              onClick={() => {
                if (value === "logic")
                  setControl(
                    part.startsWith("button:")
                      ? Number(part.slice(7))
                      : component.type === "form"
                        ? 0
                        : null,
                  );
                setTab(value);
                setExpanded(false);
                setTool("looks");
                setStyleTools(false);
              }}
            >
              {value === "design"
                ? "Design"
                : component.type === "tooltip"
                  ? "Appears"
                  : "Logic"}
            </button>
          ))}
        </div>
      </header>
      <ComponentStage
        component={component}
        part={
          tab === "logic"
            ? selectedControl === null
              ? "whole"
              : `button:${selectedControl}`
            : part
        }
        onPart={selectPart}
        badge={
          tab === "logic" && selectedControl !== null
            ? `${controls[selectedControl].label} → ${actionLabel}`
            : undefined
        }
      >
        <div className={styles.stageAssistant} ref={setStageTarget} />
      </ComponentStage>
      <section
        ref={sheetRef}
        className={styles.sheet}
        data-code={code}
        aria-label={
          code
            ? "Component code"
            : tab === "design"
              ? "Design tools"
              : "Logic tools"
        }
      >
        <div className={styles.grabber} aria-hidden="true" />
        {blocked && !code && (
          <div
            className={styles.notice}
            role={feedback.state === "invalid" ? "alert" : "status"}
          >
            <strong>
              {feedback.state === "invalid"
                ? "Your code needs attention"
                : "Checking your changes…"}
            </strong>
            {feedback.state === "invalid" && (
              <>
                <p>{feedback.message}</p>
                <button
                  type="button"
                  onClick={() => openCode(feedback.part ?? "structure")}
                >
                  Open Code
                </button>
                {onRestore && (
                  <button type="button" onClick={onRestore}>
                    Restore previous version
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {code ? (
          <>
            <CodeSheet
              component={component}
              part={sourcePart}
              onPart={openCode}
              logic={tab === "logic"}
              feedback={feedback}
              expanded={expanded}
              onExpand={() => setExpanded(!expanded)}
              onRestore={onRestore}
            />
            <div className={styles.codeAssistant} ref={setCodeTarget} />
          </>
        ) : tab === "design" ? (
          <DesignPanel
            component={component}
            part={part}
            onPart={selectPart}
            tool={tool}
            blocked={blocked}
          />
        ) : (
          <LogicPanel
            key={`${component.id}:${selectedControl}`}
            component={component}
            control={selectedControl}
            onCode={() => openCode("logic")}
          />
        )}
      </section>
      <OrbAssistant
        placement="floating"
        portalTarget={code ? codeTarget : stageTarget}
      />
      {tab === "design" ? (
        <PageToolbar
          tools={(styleTools
            ? STYLE_TOOLS
            : MAIN_TOOLS.filter(
                (item) => item.id !== "fields" || component.type === "form",
              )
          ).map((item) => ({
            ...item,
            warning: item.id === "code" && feedback.state === "invalid",
          }))}
          selected={tool}
          onBack={
            styleTools
              ? () => {
                  setStyleTools(false);
                  setTool("looks");
                }
              : undefined
          }
          onSelect={(id) => {
            if (id === "code") openCode("structure");
            else {
              setTool(id as DesignTool);
              setExpanded(false);
              if (id === "looks") setStyleTools(true);
            }
          }}
        />
      ) : (
        <PageToolbar
          tools={logicTools}
          selected={
            selectedControl === null ? "whole" : String(selectedControl)
          }
          onSelect={(id) => {
            setControl(id === "whole" ? null : Number(id));
            selectPart(id === "whole" ? "whole" : `button:${Number(id)}`);
            setTool("looks");
            setExpanded(false);
          }}
        />
      )}
    </main>
  );
}
