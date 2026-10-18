import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { SheetDockContext } from "../../ui/sheets/SheetDockContext";
import { clearSelection } from "../../state/editing/clearSelection";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { usePanelResize } from "./usePanelResize";
import { useWorkspaceMeasurements } from "./useWorkspaceMeasurements";
import { useSheetKeyboard } from "./useSheetKeyboard";
import { useThreadDock } from "./useThreadDock";
import { useOutsideSelection } from "./useOutsideSelection";
import { editorPanelHeight, workspaceGeometry } from "./workspaceGeometry";
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
  assistant?: (
    expanded: boolean,
    target: HTMLElement | null,
    keyboardOpen: boolean,
  ) => ReactNode;
  assistantActive?: boolean;
  onDismiss(): void;
};

export function EditorWorkspace({
  open,
  componentSheet = false,
  animationSheet = false,
  codeEditingId,
  trying = false,
  debugPanel,
  debugOpen = false,
  onCloseDebug,
  threadOpen = false,
  threadCollapsed = false,
  onCloseThread,
  header,
  media,
  preview,
  playback,
  timeline,
  sheets,
  assistant,
  assistantActive,
  onDismiss,
}: Props) {
  const measurements = useWorkspaceMeasurements();
  const [expandedCodeId, setExpandedCodeId] = useState<string | null>(null);
  const [assistantTarget, setAssistantTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const dockThreadOpen = threadOpen && !trying && !debugOpen && !codeEditingId;
  const codeExpanded =
    open &&
    !dockThreadOpen &&
    !trying &&
    !debugOpen &&
    !!codeEditingId &&
    expandedCodeId === codeEditingId;
  const setCodeExpanded = useCallback(
    (expanded: boolean) => {
      setExpandedCodeId(expanded ? (codeEditingId ?? null) : null);
    },
    [codeEditingId],
  );
  useLayoutEffect(() => {
    if (!trying && (!open || expandedCodeId !== codeEditingId))
      setExpandedCodeId(null);
  }, [open, codeEditingId, expandedCodeId, trying]);
  const dismissHandler = useRef<(() => void) | null>(null);
  const registerDismiss = useCallback((handler: () => void) => {
    dismissHandler.current = handler;
    return () => {
      if (dismissHandler.current === handler) dismissHandler.current = null;
    };
  }, []);
  const available = Math.max(
    0,
    measurements.height - measurements.header - measurements.playback,
  );
  const dismiss = useCallback(
    () => (dismissHandler.current ?? onDismiss)(),
    [onDismiss],
  );
  const debugGeometry = mobileDebugPanelGeometry(available);
  const debugResize = usePanelResize({
    ...debugGeometry,
    dismissBelow: 160,
    dismiss: onCloseDebug,
  });
  useOutsideSelection(measurements.workspaceRef, () => {
    if (
      !assistantActive &&
      !dockThreadOpen &&
      !codeExpanded &&
      !trying &&
      !debugOpen
    )
      clearSelection(dismiss);
  });
  const sheetKeyboardHeight = useSheetKeyboard(
    measurements.workspaceRef,
    !dockThreadOpen &&
      open &&
      componentSheet &&
      !trying &&
      !debugOpen &&
      !codeExpanded,
  );
  const threadDock = useThreadDock({
    workspaceRef: measurements.workspaceRef,
    measurements,
    open: dockThreadOpen,
    collapsed: threadCollapsed,
    onClose: onCloseThread,
  });
  const keyboardHeight = dockThreadOpen
    ? threadDock.keyboardHeight
    : sheetKeyboardHeight;
  const context = useMemo(
    () => ({
      expanded: codeExpanded,
      setExpanded: setCodeExpanded,
      registerDismiss,
      assistantActive,
      registerAssistantTarget: setAssistantTarget,
    }),
    [codeExpanded, setCodeExpanded, registerDismiss, assistantActive],
  );
  // Playback keeps five eighths; the lower region uses the remaining three eighths.
  // Measurements already follow visualViewport, including the on-screen keyboard.
  let panelHeight = editorPanelHeight(measurements);
  if (dockThreadOpen) panelHeight = threadDock.resize.height;
  else if (debugOpen) panelHeight = debugResize.height;
  else if (trying) panelHeight = 0;
  else if (codeExpanded) panelHeight = measurements.height * 0.8;
  const layoutMeasurements = dockThreadOpen
    ? threadDock.measurements
    : codeExpanded
      ? { ...measurements, playback: 0 }
      : measurements;
  const layout = workspaceGeometry(
    layoutMeasurements,
    panelHeight,
    dockThreadOpen || debugOpen || codeExpanded,
  );
  const headerVisible =
    !codeExpanded && !(dockThreadOpen && threadDock.compact);
  const style = {
    "--dock-height": `${panelHeight}px`,
    "--header-height": `${layout.header}px`,
    "--preview-height": `${layout.preview}px`,
    "--playback-height": `${layout.playback}px`,
    "--keyboard-height": `${keyboardHeight}px`,
  } as CSSProperties;

  return (
    <div
      ref={measurements.workspaceRef}
      className={`editorWorkspace ${styles.workspace}`}
      data-sheet-open={open}
      data-animation-open={animationSheet}
      data-resizing={
        dockThreadOpen
          ? threadDock.resize.dragging
          : debugOpen && debugResize.dragging
      }
      data-thread-open={dockThreadOpen}
      data-thread-compact={dockThreadOpen && threadDock.compact}
      data-debug-open={debugOpen}
      data-trying={trying}
      data-keyboard-open={keyboardHeight > 0}
      data-code-expanded={codeExpanded}
      data-preview-visible={layout.previewVisible}
      data-playback-visible={layout.playbackVisible}
      style={style}
      onKeyDown={(event) => {
        if (
          dockThreadOpen &&
          event.key === "Escape" &&
          !event.defaultPrevented
        ) {
          event.preventDefault();
          event.stopPropagation();
          onCloseThread?.();
        } else if (
          debugOpen &&
          event.key === "Escape" &&
          !event.defaultPrevented
        ) {
          event.preventDefault();
          event.stopPropagation();
          onCloseDebug?.();
        } else if (
          open &&
          !trying &&
          !assistantActive &&
          event.key === "Escape" &&
          !event.defaultPrevented
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (codeExpanded) setCodeExpanded(false);
          else dismiss();
        }
      }}
    >
      <div
        className={styles.header}
        data-visible={headerVisible}
        aria-hidden={!headerVisible}
        style={{ opacity: headerVisible ? 1 : 0 }}
        {...(!headerVisible || assistantActive ? { inert: "" } : {})}
      >
        <div ref={measurements.headerRef}>{header}</div>
      </div>
      {media && (
        <div
          className={styles.media}
          {...(trying || assistantActive || dockThreadOpen
            ? { inert: "" }
            : {})}
        >
          {media}
        </div>
      )}
      <div
        className={styles.preview}
        data-visible={layout.previewVisible}
        aria-hidden={!layout.previewVisible}
        style={{ opacity: layout.previewOpacity }}
        {...(!layout.previewVisible || assistantActive ? { inert: "" } : {})}
      >
        {preview}
      </div>
      <div
        className={styles.playback}
        data-assistant-playback
        data-visible={layout.playbackVisible}
        aria-hidden={!layout.playbackVisible}
        style={{ opacity: layout.playbackOpacity }}
        {...(!layout.playbackVisible || assistantActive ? { inert: "" } : {})}
      >
        <div ref={measurements.playbackRef}>{playback}</div>
      </div>
      <div
        className={`editorDock ${styles.dock}`}
        data-sheet-open={open}
        aria-hidden={(trying && !debugOpen) || undefined}
        {...(trying && !debugOpen ? { inert: "" } : {})}
      >
        <div
          className={styles.timelinePane}
          data-active={!open && !debugOpen && !dockThreadOpen}
          aria-hidden={open || debugOpen || dockThreadOpen}
          {...(open || debugOpen || dockThreadOpen || assistantActive
            ? { inert: "" }
            : {})}
        >
          <div className={styles.timelineContent}>{timeline}</div>
        </div>
        <div
          className={styles.sheetPane}
          data-active={open && !debugOpen && !dockThreadOpen}
          aria-hidden={!open || debugOpen || dockThreadOpen}
          {...(!open || debugOpen || dockThreadOpen ? { inert: "" } : {})}
        >
          <div
            className={styles.sheetContent}
            {...(assistantActive && !codeExpanded ? { inert: "" } : {})}
          >
            <SheetDockContext.Provider value={context}>
              {sheets}
            </SheetDockContext.Provider>
          </div>
        </div>
        {debugOpen && (
          <section
            className={debugStyles.mobilePanel}
            aria-label="Try debugger"
            data-debug-workspace="mobile"
          >
            <DebugResizeHandle
              resize={debugResize}
              maximum={debugGeometry.maximum}
              normal={debugGeometry.initial}
              expanded={debugGeometry.expanded}
              mobile
            />
            {debugPanel}
          </section>
        )}
      </div>
      {assistant?.(
        codeExpanded,
        assistantTarget,
        dockThreadOpen && threadDock.keyboardHeight > 0,
      )}
      {dockThreadOpen && (
        <div className={styles.threadHandle} data-thread-resize>
          <PanelResizeHandle
            label="Resize Restyle thread"
            active
            maximum={threadDock.maximum}
            resize={threadDock.resize}
            instructions="Drag up for more exchanges; drag down to return to the assistant composer. The player stays visible."
          />
        </div>
      )}
    </div>
  );
}
