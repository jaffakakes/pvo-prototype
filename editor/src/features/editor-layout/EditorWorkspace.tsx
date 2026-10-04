import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SheetDockContext } from "../../ui/sheets/SheetDockContext";
import { clearSelection } from "../../state/editing/clearSelection";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { usePanelResize } from "./usePanelResize";
import { useTimelineMeasurements } from "./useTimelineMeasurements";
import { useWorkspaceMeasurements } from "./useWorkspaceMeasurements";
import { useSheetKeyboard } from "./useSheetKeyboard";
import { useThreadDock } from "./useThreadDock";
import { useOutsideSelection } from "./useOutsideSelection";
import { componentPanelMaximum, keyboardPanelHeight, workspaceGeometry } from "./workspaceGeometry";
import { mobileDebugPanelGeometry } from "./debugging/debugPanelGeometry";
import { DebugResizeHandle } from "./debugging/DebugResizeHandle";
import debugStyles from "./debugging/DebugWorkspace.module.css";
import styles from "./EditorWorkspace.module.css";

type Props = {
  open: boolean;
  componentSheet?: boolean;
  animationSheet?: boolean;
  codeEditingId?: string;
  trying?: boolean;
  debugPanel?: ReactNode;
  debugOpen?: boolean;
  onCloseDebug?(): void;
  threadOpen?: boolean;
  threadCollapsed?: boolean;
  onCloseThread?(): void;
  header: ReactNode;
  media?: ReactNode;
  preview: ReactNode;
  playback: ReactNode;
  timeline: ReactNode;
  sheets: ReactNode;
  assistant?: (expanded: boolean, target: HTMLElement | null, keyboardOpen: boolean) => ReactNode;
  assistantActive?: boolean;
  onDismiss(): void;
};

export function EditorWorkspace({ open, componentSheet = false, animationSheet = false, codeEditingId, trying = false,
  debugPanel, debugOpen = false, onCloseDebug, threadOpen = false, threadCollapsed = false, onCloseThread,
  header, media, preview, playback, timeline, sheets, assistant, assistantActive, onDismiss }: Props) {
  const measurements = useWorkspaceMeasurements();
  const [expandedCodeId, setExpandedCodeId] = useState<string | null>(null);
  const [assistantTarget, setAssistantTarget] = useState<HTMLDivElement | null>(null);
  const dockThreadOpen = threadOpen && !trying && !debugOpen && !codeEditingId;
  const codeExpanded = open && !dockThreadOpen && !trying && !debugOpen && !!codeEditingId && expandedCodeId === codeEditingId;
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
  const sheetMaximum = componentSheet || animationSheet ? componentPanelMaximum(measurements, measurements.width) : maximum;
  const timelineMinimum = Math.min(timelineMetrics.minimum, maximum);
  const initial = Math.min(maximum, Math.max(timelineMinimum, Math.min(timelineMetrics.naturalHeight,
    Math.max(0, available - (measurements.height - measurements.header < 420 ? 64 : 96)))));
  const dismiss = () => (dismissHandler.current ?? onDismiss)();
  const sheetResize = usePanelResize({ maximum: sheetMaximum, initial: animationSheet ? Math.min(372, sheetMaximum) : initial, minimum: componentSheet ? 150 : 180, dismissBelow: componentSheet ? 120 : 96, dismiss });
  const timelineResize = usePanelResize({ maximum, initial, minimum: timelineMinimum });
  const debugGeometry = mobileDebugPanelGeometry(available);
  const debugResize = usePanelResize({ ...debugGeometry, dismissBelow: 160, dismiss: onCloseDebug });
  useOutsideSelection(measurements.workspaceRef, () => {
    if (!assistantActive && !dockThreadOpen && !codeExpanded && !trying && !debugOpen) clearSelection(sheetResize.dismiss);
  });
  const previousAnimationSheet = useRef(false);
  useLayoutEffect(() => {
    if (animationSheet && measurements.height === 0) return;
    if (animationSheet && !previousAnimationSheet.current) sheetResize.setHeight(Math.min(372, sheetMaximum));
    previousAnimationSheet.current = animationSheet;
  }, [animationSheet, measurements.height, sheetMaximum, sheetResize.setHeight]);
  const previousComponentSheet = useRef(false);
  useLayoutEffect(() => {
    // Routed Try scenes clear their editing selection; Stop restores the original panel.
    if (trying) return;
    if (componentSheet && measurements.height === 0) return;
    if (componentSheet && !previousComponentSheet.current) sheetResize.setHeight(timelineResize.height);
    previousComponentSheet.current = componentSheet;
  }, [componentSheet, trying, measurements.height, sheetResize.setHeight, timelineResize.height]);
  const resize = open ? sheetResize : timelineResize;
  const sheetKeyboardHeight = useSheetKeyboard(measurements.workspaceRef,
    !dockThreadOpen && open && componentSheet && !trying && !debugOpen && !codeExpanded);
  const threadDock = useThreadDock({ workspaceRef: measurements.workspaceRef, measurements,
    open: dockThreadOpen, collapsed: threadCollapsed, onClose: onCloseThread });
  const keyboardHeight = dockThreadOpen ? threadDock.keyboardHeight : sheetKeyboardHeight;
  const context = useMemo(() => ({
    expanded: codeEditingId ? codeExpanded : sheetResize.expanded,
    setExpanded: codeEditingId ? setCodeExpanded : sheetResize.setExpanded,
    registerDismiss, assistantActive, registerAssistantTarget: setAssistantTarget,
  }), [codeEditingId, codeExpanded, setCodeExpanded, sheetResize.expanded, sheetResize.setExpanded, registerDismiss, assistantActive]);
  // Expansion is a presentation overlay: the user's normal panel size stays untouched.
  // Measurements already follow visualViewport, including the on-screen keyboard.
  let panelHeight = resize.height;
  if (dockThreadOpen) panelHeight = threadDock.resize.height;
  else if (debugOpen) panelHeight = debugResize.height;
  else if (trying) panelHeight = 0;
  else if (codeExpanded) panelHeight = measurements.height * 0.8;
  else if (keyboardHeight) panelHeight = keyboardPanelHeight(sheetResize.height, sheetMaximum, keyboardHeight);
  const layoutMeasurements = dockThreadOpen ? threadDock.measurements
    : codeExpanded ? { ...measurements, playback: 0 } : measurements;
  const layout = workspaceGeometry(layoutMeasurements,
    panelHeight, dockThreadOpen || debugOpen || open || timelineResize.customized);
  const style = {
    "--dock-height": `${panelHeight}px`,
    "--header-height": `${layout.header}px`, "--preview-height": `${layout.preview}px`,
    "--playback-height": `${layout.playback}px`,
    "--keyboard-height": `${keyboardHeight}px`,
  } as CSSProperties;

  return <div ref={measurements.workspaceRef} className={`editorWorkspace ${styles.workspace}`}
    data-sheet-open={open} data-animation-open={animationSheet}
    data-panel-fullscreen={!dockThreadOpen && !debugOpen && resize.expanded && !componentSheet}
    data-resizing={dockThreadOpen ? threadDock.resize.dragging : debugOpen ? debugResize.dragging : resize.dragging}
    data-thread-open={dockThreadOpen} data-thread-compact={dockThreadOpen && threadDock.compact}
    data-debug-open={debugOpen}
    data-trying={trying} data-keyboard-open={keyboardHeight > 0} data-code-expanded={codeExpanded}
    data-preview-visible={layout.previewVisible} data-playback-visible={layout.playbackVisible}
    style={style} onKeyDown={event => {
      if (dockThreadOpen && event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        onCloseThread?.();
      } else if (debugOpen && event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        onCloseDebug?.();
      } else if (open && !trying && !assistantActive && event.key === "Escape" && !event.defaultPrevented) {
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
    {media && <div className={styles.media} {...(trying || assistantActive || dockThreadOpen ? { inert: "" } : {})}>{media}</div>}
    <div className={styles.preview} data-visible={layout.previewVisible} aria-hidden={!layout.previewVisible}
      style={{ opacity: layout.previewOpacity }} {...(!layout.previewVisible || assistantActive ? { inert: "" } : {})}>{preview}</div>
    <div className={styles.playback} data-assistant-playback data-visible={layout.playbackVisible} aria-hidden={!layout.playbackVisible}
      style={{ opacity: layout.playbackOpacity }} {...(!layout.playbackVisible || assistantActive ? { inert: "" } : {})}>
      <div ref={measurements.playbackRef}>{playback}</div>
    </div>
    <div className={`editorDock ${styles.dock}`} data-sheet-open={open} aria-hidden={trying && !debugOpen || undefined}
      {...(trying && !debugOpen ? { inert: "" } : {})}>
      <div className={styles.timelinePane} data-active={!open && !debugOpen && !dockThreadOpen}
        aria-hidden={open || debugOpen || dockThreadOpen}
        {...(open || debugOpen || dockThreadOpen || assistantActive ? { inert: "" } : {})}>
        <PanelResizeHandle label="Resize timeline" active={!open && !dockThreadOpen} maximum={maximum} minimum={timelineMinimum}
          resize={timelineResize} instructions="Drag up for more tracks or fullscreen; drag down for a larger player. Home expands; End collapses; Escape restores the default size." />
        <div ref={timelineContentRef} className={styles.timelineContent}>{timeline}</div>
      </div>
      <div className={styles.sheetPane} data-active={open && !debugOpen && !dockThreadOpen}
        aria-hidden={!open || debugOpen || dockThreadOpen}
        {...(!open || debugOpen || dockThreadOpen ? { inert: "" } : {})}>
        <div className={styles.sheetContent} {...(assistantActive && !codeExpanded ? { inert: "" } : {})}>
          {!codeExpanded && <PanelResizeHandle label="Resize editing panel" active={open && !trying && !dockThreadOpen} maximum={sheetMaximum} resize={sheetResize}
            instructions={componentSheet ? "Drag up for more controls; drag down to return to the timeline. The video stays visible." : "Drag up for fullscreen; drag down to show the player or return to timeline."} />}
          <SheetDockContext.Provider value={context}>{sheets}</SheetDockContext.Provider>
        </div>
      </div>
      {debugOpen && <section className={debugStyles.mobilePanel} aria-label="Try debugger" data-debug-workspace="mobile">
        <DebugResizeHandle resize={debugResize} maximum={debugGeometry.maximum}
          normal={debugGeometry.initial} expanded={debugGeometry.expanded} mobile />
        {debugPanel}
      </section>}
    </div>
    {assistant?.(codeExpanded, assistantTarget, dockThreadOpen && threadDock.keyboardHeight > 0)}
    {dockThreadOpen && <div className={styles.threadHandle} data-thread-resize>
      <PanelResizeHandle label="Resize Restyle thread" active maximum={threadDock.maximum} resize={threadDock.resize}
        instructions="Drag up for more exchanges; drag down to return to the assistant composer. The player stays visible." />
    </div>}
  </div>;
}
