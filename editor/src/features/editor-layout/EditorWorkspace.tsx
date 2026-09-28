import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SheetDockContext } from "../../ui/sheets/SheetDockContext";
import { clearSelection } from "../../state/editing/clearSelection";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { usePanelResize } from "./usePanelResize";
import { useTimelineMeasurements } from "./useTimelineMeasurements";
import { useWorkspaceMeasurements } from "./useWorkspaceMeasurements";
import { useSheetKeyboard } from "./useSheetKeyboard";
import { useOutsideSelection } from "./useOutsideSelection";
import { componentPanelMaximum, keyboardPanelHeight, workspaceGeometry } from "./workspaceGeometry";
import styles from "./EditorWorkspace.module.css";

type Props = {
  open: boolean;
  componentSheet?: boolean;
  codeEditingId?: string;
  trying?: boolean;
  header: ReactNode;
  media?: ReactNode;
  preview: ReactNode;
  playback: ReactNode;
  timeline: ReactNode;
  sheets: ReactNode;
  assistant?: (expanded: boolean, target: HTMLElement | null) => ReactNode;
  assistantActive?: boolean;
  onDismiss(): void;
};

export function EditorWorkspace({ open, componentSheet = false, codeEditingId, trying = false, header, media, preview, playback, timeline, sheets, assistant, assistantActive, onDismiss }: Props) {
  const measurements = useWorkspaceMeasurements();
  const [expandedCodeId, setExpandedCodeId] = useState<string | null>(null);
  const [assistantTarget, setAssistantTarget] = useState<HTMLDivElement | null>(null);
  const codeExpanded = open && !trying && !!codeEditingId && expandedCodeId === codeEditingId;
  const setCodeExpanded = useCallback((expanded: boolean) => {
    setExpandedCodeId(expanded ? codeEditingId ?? null : null);
  }, [codeEditingId]);
  useLayoutEffect(() => {
    if (!trying && (!open || expandedCodeId !== codeEditingId)) setExpandedCodeId(null);
  }, [open, codeEditingId, expandedCodeId, trying]);
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const timelineMetrics = useTimelineMeasurements(timelineContentRef, measurements.height);
  const dismissHandler = useRef<(() => void) | null>(null);
  const registerDismiss = useCallback((handler: () => void) => {
    dismissHandler.current = handler;
    return () => { if (dismissHandler.current === handler) dismissHandler.current = null; };
  }, []);
  const available = Math.max(0, measurements.height - measurements.header - measurements.playback);
  const maximum = measurements.height;
  const sheetMaximum = componentSheet ? componentPanelMaximum(measurements, measurements.width) : maximum;
  const timelineMinimum = Math.min(timelineMetrics.minimum, maximum);
  const initial = Math.min(maximum, Math.max(timelineMinimum, Math.min(timelineMetrics.naturalHeight,
    Math.max(0, available - (measurements.height - measurements.header < 420 ? 64 : 96)))));
  const dismiss = () => (dismissHandler.current ?? onDismiss)();
  const sheetResize = usePanelResize({ maximum: sheetMaximum, initial, minimum: componentSheet ? 150 : 180, dismissBelow: componentSheet ? 120 : 96, dismiss });
  const timelineResize = usePanelResize({ maximum, initial, minimum: timelineMinimum });
  useOutsideSelection(measurements.workspaceRef, () => {
    if (!assistantActive && !codeExpanded) clearSelection(sheetResize.dismiss);
  });
  const previousComponentSheet = useRef(false);
  useLayoutEffect(() => {
    // Routed Try scenes clear their editing selection; Stop restores the original panel.
    if (trying) return;
    if (componentSheet && measurements.height === 0) return;
    if (componentSheet && !previousComponentSheet.current) sheetResize.setHeight(timelineResize.height);
    previousComponentSheet.current = componentSheet;
  }, [componentSheet, trying, measurements.height, sheetResize.setHeight, timelineResize.height]);
  const resize = open ? sheetResize : timelineResize;
  const keyboardHeight = useSheetKeyboard(measurements.workspaceRef, open && componentSheet && !trying && !codeExpanded);
  const context = useMemo(() => ({
    expanded: codeEditingId ? codeExpanded : sheetResize.expanded,
    setExpanded: codeEditingId ? setCodeExpanded : sheetResize.setExpanded,
    registerDismiss, assistantActive, registerAssistantTarget: setAssistantTarget,
  }), [codeEditingId, codeExpanded, setCodeExpanded, sheetResize.expanded, sheetResize.setExpanded, registerDismiss, assistantActive]);
  // Expansion is a presentation overlay: the user's normal panel size stays untouched.
  // Measurements already follow visualViewport, including the on-screen keyboard.
  const panelHeight = trying ? 0 : codeExpanded ? measurements.height * 0.8 : keyboardHeight
    ? keyboardPanelHeight(sheetResize.height, sheetMaximum, keyboardHeight)
    : resize.height;
  const layout = workspaceGeometry(codeExpanded ? { ...measurements, playback: 0 } : measurements,
    panelHeight, open || timelineResize.customized);
  const style = {
    "--dock-height": `${panelHeight}px`,
    "--header-height": `${layout.header}px`, "--preview-height": `${layout.preview}px`,
    "--playback-height": `${layout.playback}px`,
    "--keyboard-height": `${keyboardHeight}px`,
  } as CSSProperties;

  return <div ref={measurements.workspaceRef} className={`editorWorkspace ${styles.workspace}`}
    data-sheet-open={open} data-panel-fullscreen={resize.expanded && !componentSheet} data-resizing={resize.dragging}
    data-trying={trying} data-keyboard-open={keyboardHeight > 0} data-code-expanded={codeExpanded}
    data-preview-visible={layout.previewVisible} data-playback-visible={layout.playbackVisible}
    style={style} onKeyDown={event => {
      if (open && !trying && !assistantActive && event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        if (codeExpanded) setCodeExpanded(false);
        else resize.dismiss();
      }
    }}>
    <div className={styles.header} data-visible={layout.headerVisible} aria-hidden={!layout.headerVisible}
      style={{ opacity: layout.headerOpacity }} {...(!layout.headerVisible || assistantActive ? { inert: "" } : {})}>
      <div ref={measurements.headerRef}>{header}</div>
    </div>
    {media && <div className={styles.media} {...(trying || assistantActive ? { inert: "" } : {})}>{media}</div>}
    <div className={styles.preview} data-visible={layout.previewVisible} aria-hidden={!layout.previewVisible}
      style={{ opacity: layout.previewOpacity }} {...(!layout.previewVisible || assistantActive ? { inert: "" } : {})}>{preview}</div>
    <div className={styles.playback} data-assistant-playback data-visible={layout.playbackVisible} aria-hidden={!layout.playbackVisible}
      style={{ opacity: layout.playbackOpacity }} {...(!layout.playbackVisible || assistantActive ? { inert: "" } : {})}>
      <div ref={measurements.playbackRef}>{playback}</div>
    </div>
    <div className={`editorDock ${styles.dock}`} data-sheet-open={open} aria-hidden={trying || undefined}
      {...(trying ? { inert: "" } : {})}>
      <div className={styles.timelinePane} data-active={!open} aria-hidden={open}
        {...(open || assistantActive ? { inert: "" } : {})}>
        <PanelResizeHandle label="Resize timeline" active={!open} maximum={maximum} minimum={timelineMinimum}
          resize={timelineResize} instructions="Drag up for more tracks or fullscreen; drag down for a larger player. Home expands; End collapses; Escape restores the default size." />
        <div ref={timelineContentRef} className={styles.timelineContent}>{timeline}</div>
      </div>
      <div className={styles.sheetPane} data-active={open} aria-hidden={!open}
        {...(!open ? { inert: "" } : {})}>
        <div className={styles.sheetContent} {...(assistantActive && !codeExpanded ? { inert: "" } : {})}>
          {!codeExpanded && <PanelResizeHandle label="Resize editing panel" active={open && !trying} maximum={sheetMaximum} resize={sheetResize}
            instructions={componentSheet ? "Drag up for more controls; drag down to return to the timeline. The video stays visible." : "Drag up for fullscreen; drag down to show the player or return to timeline."} />}
          <SheetDockContext.Provider value={context}>{sheets}</SheetDockContext.Provider>
        </div>
      </div>
    </div>
    {assistant?.(codeExpanded, assistantTarget)}
  </div>;
}
