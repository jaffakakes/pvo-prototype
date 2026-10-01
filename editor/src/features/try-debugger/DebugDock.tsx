import type { KeyboardEvent } from "react";
import { ReadinessList } from "./shared/ReadinessList";
import { ActivityList } from "./shared/ActivityList";
import { DebugIcon } from "./shared/DebugIcon";
import { InteractionDetails } from "./shared/InteractionDetails";
import { RequestDetails, RequestList } from "./shared/RequestsPane";
import { StatePane } from "./shared/StatePane";
import { StatusLine } from "./shared/StatusLine";
import { selectDebugGroup, selectDebugRequest, setDebugComponentFilter, setDebugTab, toggleDebugPin, useDebugUi, type DebugTab } from "./uiStore";
import { useDebugPanel } from "./useDebugPanel";
import styles from "./TryDebugger.module.css";

export type DebugPanelProps = {
  onClose: () => void;
  onEditComponent: (componentId: string, tab: "action" | "logic") => void;
  onLocate: (componentId: string) => void;
};

export function DebugDock({ onClose, onTimeline, onEditComponent, onLocate }: DebugPanelProps & { onTimeline: () => void }) {
  const panel = useDebugPanel(onClose);
  const { ui, run, status, readiness, requests, values, groups } = panel;
  const selectComponent = (id: string) => setDebugComponentFilter(id === ui.componentId ? "all" : id);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (useDebugUi.getState().overlay) useDebugUi.setState({ overlay: null });
    else panel.close();
  };

  return <section className={styles.dock} aria-label="Try debugger" data-debug-dock onKeyDown={onKeyDown}>
    <header className={styles.dockTop}>
      <div className={styles.workspaceTabs} role="tablist" aria-label="Workspace">
        <button type="button" role="tab" aria-selected={false} onClick={onTimeline}><DebugIcon name="timeline" size={14} /><span>Timeline</span></button>
        <button type="button" role="tab" aria-selected={true}><DebugIcon name="activity" size={14} /><span>Debug</span>{panel.errors > 0 && <span className={styles.errorBadge}>{panel.errors}</span>}</button>
      </div>
      <span className={styles.topDivider} />
      <StatusLine status={status} density="desktop" holdComponentName={panel.holdComponentName} onHoldSelect={panel.selectHold} />
      <div className={styles.topActions}>
        <button type="button" className={styles.captureButton} data-active={panel.captureData}
          disabled={run?.status !== "running"} aria-pressed={panel.captureData} aria-label={`Capture data for this run, ${panel.captureData ? "on" : "off"}`}
          title="Keep bounded request and response data for new activity in this run" onClick={panel.toggleCapture}>
          <span className={styles.captureLabel}>Capture data</span><span className={styles.toggleTrack}><i /></span>
        </button>
        <button type="button" className={styles.reportButton} onClick={() => useDebugUi.setState({ overlay: "report" })}><DebugIcon name="copy" size={13} />Copy report</button>
        <button type="button" className={styles.closeButton} title="Close Debug · back to the timeline" aria-label="Close Debug" onClick={panel.close}><DebugIcon name="close" size={13} /></button>
      </div>
    </header>

    {ui.tab === "state" ? <div className={styles.desktopBody} role="tabpanel" aria-label="State">
      <StatePane run={run} rows={values} pinnedPaths={ui.pinnedPaths} density="desktop" onTogglePin={toggleDebugPin} />
    </div> : <div className={styles.desktopBody} data-view={ui.mobileView} role="tabpanel" aria-label={ui.tab === "activity" ? "Activity" : "Requests"}>
      <div className={styles.listColumn}>
        <div className={styles.listToolbar}>
          <div className={styles.debugTabs} role="tablist" aria-label="Debug views">
            {(["activity", "state", "requests"] as DebugTab[]).map(tab => <button key={tab} type="button" role="tab" aria-selected={ui.tab === tab} onClick={() => setDebugTab(tab)}>
              {tab === "activity" ? "Activity" : tab === "state" ? "State" : "Requests"}{tab === "requests" && requests.length > 0 && <span className={styles.tabCount}>{requests.length}</span>}
            </button>)}
          </div>
          {ui.tab === "activity" && <>
            <span className={styles.topDivider} />
            <button type="button" className={styles.filterButton} data-active={ui.componentId !== "all"}
              aria-expanded={ui.overlay === "components"} onClick={() => useDebugUi.setState({ overlay: ui.overlay === "components" ? null : "components" })}>
              {readiness.find(component => component.id === ui.componentId)?.name ?? "All components"}<DebugIcon name="down" size={12} />
            </button>
            <button type="button" className={styles.filterButton} data-active={ui.issuesOnly} aria-pressed={ui.issuesOnly}
              aria-label={`Issues only, ${panel.issues}`} onClick={() => useDebugUi.setState({ issuesOnly: !ui.issuesOnly })}>
              <DebugIcon name="warn" size={12} /><span className={styles.issuesLabel}>Issues only · {panel.issues}</span>
            </button>
          </>}
        </div>
        {ui.tab === "activity" ? <ActivityList groups={panel.visibleGroups} selectedId={ui.selectedGroupId} density="desktop"
          followLatest={ui.followLatest} listening={panel.listening} filtered={panel.filtered} cleared={ui.cleared}
          onSelect={selectDebugGroup} onKeyboardSelect={id => useDebugUi.setState({ selectedGroupId: id, mobileView: "list" })} onResetFilters={panel.resetFilters} />
          : <RequestList requests={requests} selectedId={ui.selectedRequestId} density="desktop" failedOnly={false} overflow={run?.requestOverflow}
            onToggleFailedOnly={() => {}} onSelect={selectDebugRequest} onKeyboardSelect={id => useDebugUi.setState({ selectedRequestId: id, mobileView: "list" })} />}
        <footer className={styles.listFooter}>
          {ui.tab === "activity" ? <>
            <button type="button" className={styles.followButton} aria-pressed={ui.followLatest} onClick={() => useDebugUi.setState({ followLatest: !ui.followLatest })}>
              <span className={styles.toggleTrack}><i /></span>Follow latest
            </button>
            <span>{groups.length} records · {run?.discarded ? `${run.discarded} older discarded` : "none discarded"}</span>
            <button type="button" className={styles.textButton} onClick={panel.clearCompleted}>Clear completed</button>
          </> : <span>{panel.captureData ? "Capturing bounded data for new requests · secrets masked" : "Metadata only · bodies need Capture data"}</span>}
        </footer>
        {ui.overlay === "components" && <>
          <button type="button" className={styles.popoverScrim} aria-label="Close component filter" onClick={() => useDebugUi.setState({ overlay: null })} />
          <div className={styles.componentPopover}>
            <button type="button" className={styles.allComponents} onClick={() => setDebugComponentFilter("all")}>All components</button>
            <ReadinessList components={readiness} activeId={ui.componentId} onSelect={selectComponent} density="desktop" overflow={run?.componentOverflow} />
          </div>
        </>}
      </div>
      <div className={styles.detailsColumn}>
        {ui.tab === "activity" ? <InteractionDetails group={panel.selectedGroup} run={run} readiness={readiness} requests={requests}
          density="desktop" componentFilter={ui.componentId} onFilterComponent={selectComponent} onBack={() => useDebugUi.setState({ mobileView: "list" })}
          onEditComponent={onEditComponent} onLocate={onLocate} />
          : <RequestDetails request={panel.selectedRequest} density="desktop" captureData={panel.captureData} canCapture={run?.status === "running"}
            onBack={() => useDebugUi.setState({ mobileView: "list" })} onToggleCapture={panel.toggleCapture} onShowActivity={panel.showActivity} />}
      </div>
    </div>}

    {ui.tab === "state" && <div className={styles.stateTabs} role="tablist" aria-label="Debug views">
      {(["activity", "state", "requests"] as DebugTab[]).map(tab => <button key={tab} type="button" role="tab" aria-selected={ui.tab === tab} onClick={() => setDebugTab(tab)}>{tab === "activity" ? "Activity" : tab === "state" ? "State" : "Requests"}</button>)}
      <span>Current state · read-only</span>
    </div>}

    {ui.overlay === "report" && <div className={styles.reportPopover} role="dialog" aria-label="Copy report">
      <header><h2>Copy report</h2><button type="button" className={styles.closeButton} onClick={() => useDebugUi.setState({ overlay: null })} aria-label="Close report"><DebugIcon name="close" size={13} /></button></header>
      <p>Sanitized for sharing: stage and reason codes with versions and timing. Request bodies, private values, credentials and URL query values are left out.</p>
      <pre>{panel.reportText}</pre>
      <footer><button type="button" className={styles.secondaryButton} onClick={() => useDebugUi.setState({ overlay: null })}>Cancel</button><button type="button" className={styles.primaryButton} onClick={panel.copyReport}><DebugIcon name="copy" size={14} />Copy report</button></footer>
    </div>}
    {ui.feedback && <p className={styles.feedback} role="status">{ui.feedback}</p>}
  </section>;
}
