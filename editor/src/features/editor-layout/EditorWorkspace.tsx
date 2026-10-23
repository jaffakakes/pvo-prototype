import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useToolSwap } from "../../ui/motion/useToolSwap";
import { SheetDockContext } from "../../ui/sheets/SheetDockContext";
import { clearSelection } from "../../state/editing/clearSelection";
import { usePanelResize } from "./usePanelResize";
import { useWorkspaceMeasurements } from "./useWorkspaceMeasurements";
import { useSheetKeyboard } from "./useSheetKeyboard";
import { useThreadDock } from "./useThreadDock";
import { useOutsideSelection } from "./useOutsideSelection";
import { OrbAssistant } from "../assistant/OrbAssistant";
import {
  assistantFocused,
  useAssistant,
} from "../../state/assistant/assistantStore";
import {
  setAssistantThreadOpen,
  useAssistantThread,
} from "../../state/assistant/threadStore";
import {
  aspectRatioPanelHeight,
  editorPanelHeight,
  workspaceGeometry,
  toolTrayLayout,
} from "./workspaceGeometry";
import { mobileDebugPanelGeometry } from "./debugging/debugPanelGeometry";
import { DebugResizeHandle } from "./debugging/DebugResizeHandle";
import debugStyles from "./debugging/DebugWorkspace.module.css";
import styles from "./EditorWorkspace.module.css";

type Props = {
  mode?: "timeline" | "design";
  className?: string;
  panelExpanded?: boolean;
  onPanelExpandedChange?(expanded: boolean): void;
  open: boolean;
  activeTool?: string | null;
  focusTool?: boolean;
  ratioOpen?: boolean;
  trayOpen?: boolean;
  componentSheet?: boolean;
  textSheet?: boolean;
  soundSheet?: boolean;
  trying?: boolean;
  debugPanel?: ReactNode;
  debugOpen?: boolean;
  onCloseDebug?(): void;
  header: ReactNode;
  media?: ReactNode;
  preview: ReactNode;
  timeline: ReactNode;
  controls?: ReactNode;
  sheets: ReactNode;
  assistantEnabled?: boolean;
  onDismiss(): void | Promise<void>;
};

export function EditorWorkspace({
  mode = "timeline",
  className = "",
  panelExpanded = false,
  onPanelExpandedChange,
  open,
  activeTool = null,
  focusTool = false,
  ratioOpen = false,
  trayOpen = false,
  componentSheet = false,
  textSheet = false,
  soundSheet = false,
  trying = false,
  debugPanel,
  debugOpen = false,
  onCloseDebug,
  header,
  media,
  preview,
  timeline,
  controls,
  sheets,
  assistantEnabled = true,
  onDismiss,
}: Props) {
  const requestedThread = useAssistantThread((state) => state.open);
  const assistantFocusedNow = useAssistant(assistantFocused);
  const threadOpen = assistantEnabled && requestedThread;
  const assistantActive =
    assistantEnabled && (assistantFocusedNow || threadOpen);
  const onCloseThread = () => setAssistantThreadOpen(false);
  const dockThreadOpen = threadOpen && !trying && !debugOpen;
  const measurements = useWorkspaceMeasurements(dockThreadOpen);
  const sheetRef = useRef<HTMLDivElement>(null);
  useToolSwap(sheetRef, open ? activeTool : null);
  const focused = open && focusTool && !trying && !debugOpen && !threadOpen;
  const codeExpanded =
    open && !dockThreadOpen && !trying && !debugOpen && panelExpanded;
  const dismissHandler = useRef<(() => void | Promise<void>) | null>(null);
  const [dismissDisabled, setDismissDisabled] = useState(false);
  const [textInputFocused, setTextInputFocused] = useState(true);
  const registerDismiss = useCallback(
    (handler: () => void | Promise<void>, options?: { disabled?: boolean }) => {
      dismissHandler.current = handler;
      setDismissDisabled(!!options?.disabled);
      return () => {
        if (dismissHandler.current === handler) {
          dismissHandler.current = null;
          setDismissDisabled(false);
        }
      };
    },
    [],
  );
  const available = Math.max(0, measurements.height - measurements.header);
  const dismiss = useCallback(() => {
    if (!dismissDisabled) return (dismissHandler.current ?? onDismiss)();
  }, [onDismiss, dismissDisabled]);
  const debugGeometry = mobileDebugPanelGeometry(available);
  const debugResize = usePanelResize({
    ...debugGeometry,
    dismissBelow: 160,
    dismiss: onCloseDebug,
  });
  useOutsideSelection(measurements.workspaceRef, () => {
    if (
      mode === "timeline" &&
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
      (componentSheet || textSheet) &&
      !trying &&
      !debugOpen &&
      !codeExpanded,
  );
  const threadDock = useThreadDock({
    workspaceRef: measurements.workspaceRef,
    measurements,
    open: dockThreadOpen,
  });
  const keyboardHeight = dockThreadOpen
    ? threadDock.keyboardHeight
    : sheetKeyboardHeight;
  const context = useMemo(
    () => ({
      expanded: codeExpanded,
      setExpanded: onPanelExpandedChange,
      registerDismiss,
      dismissFromTransport: dismiss,
      dismissDisabled,
      setTextInputFocused,
      assistantActive,
      threadKeyboardOpen: dockThreadOpen && keyboardHeight > 0,
    }),
    [
      codeExpanded,
      onPanelExpandedChange,
      registerDismiss,
      dismiss,
      dismissDisabled,
      assistantActive,
      dockThreadOpen,
      keyboardHeight,
    ],
  );
  // Playback keeps five eighths; the lower region uses the remaining three eighths.
  // Measurements already follow visualViewport, including the on-screen keyboard.
  let panelHeight = editorPanelHeight(measurements, ratioOpen);
  const trayLayout = toolTrayLayout(measurements, panelHeight);
  if (trayOpen) panelHeight = trayLayout.panelHeight;
  if (dockThreadOpen) panelHeight = threadDock.height;
  else if (debugOpen) panelHeight = debugResize.height;
  else if (trying) panelHeight = 0;
  else if (codeExpanded) panelHeight = measurements.height * 0.8;
  else if (open && soundSheet)
    panelHeight = Math.max(
      panelHeight,
      Math.min(200, Math.max(0, measurements.height - measurements.header)),
    );
  const textEditing =
    open && textSheet && !trying && !debugOpen && !dockThreadOpen;
  useLayoutEffect(() => {
    if (textEditing) {
      const field =
        measurements.workspaceRef.current?.querySelector<HTMLTextAreaElement>(
          ".textEntry textarea",
        );
      // Resolve the newly visible panel before asking the browser to open its keyboard.
      field?.getBoundingClientRect();
      field?.focus({ preventScroll: true });
    }
  }, [textEditing, measurements.workspaceRef]);
  const layoutMeasurements = dockThreadOpen
    ? { ...threadDock.measurements, header: 0 }
    : focused
      ? { ...measurements, header: 0 }
      : trayOpen
        ? { ...measurements, header: trayLayout.header }
        : measurements;
  const layout = workspaceGeometry(
    layoutMeasurements,
    panelHeight,
    dockThreadOpen || debugOpen || codeExpanded || textEditing || soundSheet,
  );
  const playbackVisible =
    layout.previewVisible &&
    !codeExpanded &&
    !(textEditing && textInputFocused);
  const headerVisible =
    !focused &&
    !codeExpanded &&
    !dockThreadOpen &&
    (!trayOpen || trayLayout.header > 0);
  const style = {
    "--dock-height": `${panelHeight}px`,
    "--ratio-panel-height": `${aspectRatioPanelHeight(measurements.height)}px`,
    "--header-height": `${layout.header}px`,
    "--preview-height": `${layout.preview}px`,
    "--keyboard-height": `${keyboardHeight}px`,
  } as CSSProperties;

  return (
    <SheetDockContext.Provider value={context}>
      <div
        ref={measurements.workspaceRef}
        className={`editorWorkspace ${styles.workspace} ${className}`}
        data-workspace-mode={mode}
        data-component-page={mode === "design" ? "" : undefined}
        data-sheet-open={open}
        data-tool-tray-open={trayOpen}
        data-text-open={textEditing}
        data-resizing={debugOpen && debugResize.dragging}
        data-thread-open={dockThreadOpen}
        data-thread-compact={dockThreadOpen && threadDock.compact}
        data-debug-open={debugOpen}
        data-trying={trying}
        data-keyboard-open={keyboardHeight > 0}
        data-code-expanded={codeExpanded}
        data-preview-visible={layout.previewVisible}
        data-playback-visible={playbackVisible}
        style={style}
        onClickCapture={(event) => {
          if (
            !dockThreadOpen ||
            !keyboardHeight ||
            !(event.target instanceof Element) ||
            !event.target.closest(".pvBox")
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
        }}
        onKeyDown={(event) => {
          if (
            dockThreadOpen &&
            event.key === "Escape" &&
            !event.defaultPrevented
          ) {
            event.preventDefault();
            event.stopPropagation();
            onCloseThread();
          } else if (
            debugOpen &&
            event.key === "Escape" &&
            !event.defaultPrevented
          ) {
            event.preventDefault();
            event.stopPropagation();
            onCloseDebug?.();
          } else if (
            (open || ratioOpen || trayOpen) &&
            !trying &&
            !assistantActive &&
            event.key === "Escape" &&
            !event.defaultPrevented
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (codeExpanded) onPanelExpandedChange?.(false);
            else dismiss();
          }
        }}
      >
        <div className={styles.surface} data-editor-surface>
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
            {...(!layout.previewVisible || (assistantActive && !dockThreadOpen)
              ? { inert: "" }
              : {})}
          >
            {preview}
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
              <div className={styles.timelineContent}>
                {timeline}
                <div
                  ref={measurements.controlsRef}
                  className={styles.controls}
                  style={{
                    maxHeight: trayOpen
                      ? trayLayout.controlsMaxHeight
                      : undefined,
                  }}
                >
                  {controls}
                </div>
              </div>
            </div>
            <div
              data-editor-dock
              className={styles.sheetPane}
              data-active={open && !debugOpen && !dockThreadOpen}
              aria-hidden={!open || debugOpen || dockThreadOpen}
              {...(!open || debugOpen || dockThreadOpen ? { inert: "" } : {})}
            >
              <div
                ref={sheetRef}
                className={styles.sheetContent}
                {...(assistantActive && !codeExpanded ? { inert: "" } : {})}
              >
                {sheets}
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
        </div>
        {assistantEnabled && (
          <OrbAssistant
            mode={mode}
            threadKeyboardOpen={dockThreadOpen && threadDock.keyboardHeight > 0}
          />
        )}
      </div>
    </SheetDockContext.Provider>
  );
}
