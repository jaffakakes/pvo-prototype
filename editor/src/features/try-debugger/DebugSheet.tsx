import type { KeyboardEvent } from "react";
import { ActivityList } from "./shared/ActivityList";
import { DebugIcon } from "./shared/DebugIcon";
import { InteractionDetails } from "./shared/InteractionDetails";
import { ReadinessList } from "./shared/ReadinessList";
import { RequestDetails, RequestList } from "./shared/RequestsPane";
import { StatePane } from "./shared/StatePane";
import { StatusLine } from "./shared/StatusLine";
import { selectDebugGroup, selectDebugRequest, setDebugComponentFilter, setDebugTab, toggleDebugPin, useDebugUi, type DebugTab } from "./uiStore";
import { useDebugPanel } from "./useDebugPanel";
import type { DebugPanelProps } from "./DebugDock";
import styles from "./TryDebugger.module.css";

export function DebugSheet({ onClose, onEditComponent, onLocate }: DebugPanelProps) {
  const panel = useDebugPanel(onClose);
  const { ui, run, status, readiness, requests, values } = panel;
  const selectComponent = (id: string) => setDebugComponentFilter(id === ui.componentId ? "all" : id);
  const goBack = () => useDebugUi.setState({ mobileView: "list", overlay: null });
  const showReport = ui.overlay === "report";
  const showComponents = ui.mobileView === "components";
  const showActivityDetail = ui.tab === "activity" && ui.mobileView === "detail" && panel.selectedGroup;
  const showRequestDetail = ui.tab === "requests" && ui.mobileView === "requestDetail";
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (useDebugUi.getState().overlay) useDebugUi.setState({ overlay: null });
    else if (useDebugUi.getState().mobileView !== "list") goBack();
    else panel.close();
  };

  return <section className={styles.sheet} aria-label="Try debugger" data-debug-sheet onKeyDown={onKeyDown}>
    {showReport ? <div className={styles.mobileReport} role="dialog" aria-label="Copy report">
      <div className={styles.backRow}><button type="button" className={styles.backButton} onClick={() => useDebugUi.setState({ overlay: null })} aria-label="Back to Debug"><DebugIcon name="back" size={18} /></button><span><h2>Copy report</h2><small>Sanitized · no bodies, private values or secrets</small></span></div>
      <pre>{panel.reportText}</pre>
      <button type="button" className={styles.primaryButton} onClick={panel.copyReport}><DebugIcon name="copy" size={15} />Copy report</button>
    </div> : <>
      <header className={styles.mobileHeader}>
        <StatusLine status={status} density="mobile" holdComponentName={panel.holdComponentName} onHoldSelect={panel.selectHold} />
        <button type="button" className={styles.moreButton} aria-label="Debug options" aria-expanded={ui.overlay === "menu"}
          onClick={() => useDebugUi.setState({ overlay: ui.overlay === "menu" ? null : "menu" })}><DebugIcon name="more" size={17} /></button>
        <button type="button" className={styles.closeButton} aria-label="Close Debug" onClick={panel.close}><DebugIcon name="close" size={15} /></button>
      </header>
      <div className={styles.mobileTabs} role="tablist" aria-label="Debug views">
        {(["activity", "state", "requests"] as DebugTab[]).map(tab => <button key={tab} type="button" role="tab" aria-selected={ui.tab === tab} onClick={() => setDebugTab(tab)}>
          {tab === "activity" ? "Activity" : tab === "state" ? "State" : "Requests"}{tab === "requests" && requests.length > 0 && <span className={styles.tabCount}>{requests.length}</span>}
        </button>)}
      </div>
      <div className={styles.mobileContent} role="tabpanel" aria-label={ui.tab}>
        {ui.tab === "activity" && showComponents && <div className={styles.mobileComponents}>
          <div className={styles.backRow}><button type="button" className={styles.backButton} onClick={goBack} aria-label="Back to activity"><DebugIcon name="back" size={18} /></button><span><h2>Components in {run?.playback.sceneName || "this scene"}</h2><small>Pick one to filter the activity</small></span></div>
          <button type="button" className={styles.allComponents} onClick={() => setDebugComponentFilter("all")}>All components</button>
          <ReadinessList components={readiness} activeId={ui.componentId} onSelect={selectComponent} density="mobile" overflow={run?.componentOverflow} />
        </div>}
        {ui.tab === "activity" && !showComponents && showActivityDetail && <InteractionDetails group={panel.selectedGroup} run={run} readiness={readiness} requests={requests}
          density="mobile" componentFilter={ui.componentId} onFilterComponent={selectComponent} onBack={goBack}
          onEditComponent={onEditComponent} onLocate={onLocate} />}
        {ui.tab === "activity" && !showComponents && !showActivityDetail && <>
          <div className={styles.mobileChips}>
            <button type="button" className={styles.filterButton} data-active={ui.componentId !== "all"} onClick={() => useDebugUi.setState({ mobileView: "components" })}>
              {readiness.find(component => component.id === ui.componentId)?.name ?? "All components"}<DebugIcon name="down" size={12} />
            </button>
            <button type="button" className={styles.filterButton} data-active={ui.issuesOnly} aria-pressed={ui.issuesOnly} onClick={() => useDebugUi.setState({ issuesOnly: !ui.issuesOnly })}>
              <DebugIcon name="warn" size={12} />Issues · {panel.issues}
            </button>
            <button type="button" className={styles.filterButton} data-active={ui.followLatest} aria-pressed={ui.followLatest} onClick={() => useDebugUi.setState({ followLatest: !ui.followLatest })}>
              ↓ Follow latest
            </button>
          </div>
          <ActivityList groups={panel.visibleGroups} selectedId={ui.selectedGroupId} density="mobile" followLatest={ui.followLatest}
            listening={panel.listening} filtered={panel.filtered} cleared={ui.cleared}
            onSelect={selectDebugGroup} onResetFilters={panel.resetFilters} />
        </>}
        {ui.tab === "state" && <StatePane run={run} rows={values} pinnedPaths={ui.pinnedPaths} density="mobile" onTogglePin={toggleDebugPin} />}
        {ui.tab === "requests" && showRequestDetail && <RequestDetails request={panel.selectedRequest} density="mobile" captureData={panel.captureData} canCapture={run?.status === "running"}
          onBack={goBack} onToggleCapture={panel.toggleCapture} onShowActivity={panel.showActivity} />}
        {ui.tab === "requests" && !showRequestDetail && <RequestList requests={requests} selectedId={ui.selectedRequestId} density="mobile" overflow={run?.requestOverflow}
          failedOnly={ui.requestsFailedOnly} onToggleFailedOnly={() => useDebugUi.setState({ requestsFailedOnly: !ui.requestsFailedOnly })} onSelect={selectDebugRequest} />}
      </div>
    </>}

    {ui.overlay === "menu" && <>
      <button type="button" className={styles.menuScrim} aria-label="Close Debug options" onClick={() => useDebugUi.setState({ overlay: null })} />
      <div className={styles.mobileMenu} role="menu">
        <button type="button" role="menuitem" onClick={() => useDebugUi.setState({ overlay: "report" })}><DebugIcon name="copy" size={16} />Copy report…</button>
        <button type="button" role="menuitem" onClick={panel.clearCompleted}><DebugIcon name="minus" size={16} />Clear completed</button>
        <span className={styles.menuDivider} />
        <button type="button" role="menuitemcheckbox" aria-checked={panel.captureData} disabled={run?.status !== "running"} onClick={() => { panel.toggleCapture(); useDebugUi.setState({ overlay: null }); }}>
          Capture data for this run<span className={styles.toggleTrack} data-active={panel.captureData}><i /></span>
        </button>
        <p>Applies to new activity. Secrets and private fields stay masked.</p>
      </div>
    </>}
    {ui.feedback && <p className={styles.feedback} role="status">{ui.feedback}</p>}
  </section>;
}
