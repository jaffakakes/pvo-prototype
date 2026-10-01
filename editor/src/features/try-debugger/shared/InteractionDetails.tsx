import type { DebugGroup, DebugReadiness, DebugRequestRow, DebugRun } from "../../../domain/debugging/types";
import { DebugIcon } from "./DebugIcon";
import { formatElapsed, formatVideoTime } from "./format";
import { ReadinessList } from "./ReadinessList";
import { ResultChip } from "./ResultChip";
import { StageList } from "./StageList";
import styles from "../TryDebugger.module.css";

type InteractionDetailsProps = {
  group: DebugGroup | null;
  run: DebugRun | null;
  readiness: DebugReadiness[];
  requests: DebugRequestRow[];
  density: "desktop" | "mobile";
  componentFilter: string;
  onFilterComponent: (id: string) => void;
  onBack?: () => void;
  onEditComponent: (componentId: string, tab: "action" | "logic") => void;
  onLocate: (componentId: string) => void;
};

function FactList({ group, component, request }: {
  group: DebugGroup;
  component?: DebugReadiness;
  request?: DebugRequestRow;
}) {
  const facts: Array<[string, string]> = [];
  if (component) {
    facts.push(["Component", `${component.name} · ${component.type}`]);
    facts.push(["Status", `${component.status === "active" ? "Active now" : component.status === "unavailable" ? "Unavailable" : component.status === "ended" ? "Ended" : "Ready"} · shows ${formatVideoTime(component.at)}–${formatVideoTime(component.end)}`]);
    facts.push(["Interactive now", component.interactiveLabel]);
    facts.push(["Action", component.type === "tooltip" ? "Display-only Note" : !component.actionKnown ? "Checking action…" : component.hasAction ? `Assigned${component.dispatch === "layer_end" ? " · at layer end" : ""}` : "None assigned"]);
    if (component.layer > 0 && component.layerCount > 0) {
      facts.push(["Layer", `Layer ${component.layer} of ${component.layerCount}${component.aboveVideo ? " · above the video" : ""}`]);
    }
    facts.push(["Last input", component.lastInput ? `${formatVideoTime(component.lastInput.videoTime)}${component.lastInput.target ? ` · ${component.lastInput.target}` : ""}` : "None received"]);
  }
  if (request) facts.push(["Request", `${request.method} ${request.path}${request.status ? ` · ${request.status}` : ""}${request.durationMs != null ? ` · ${formatElapsed(request.durationMs)}` : ""}`]);
  const revision = group.source?.revision ?? component?.source.revision;
  if (revision) facts.push(["Source", `Revision ${revision}${component?.currentRevision && component.currentRevision !== revision ? " ran · changed since" : " · ran in this Try"}`]);
  return <dl className={styles.factList}>{facts.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>;
}

function WhyCard({ group, run, component }: { group: DebugGroup; run: DebugRun | null; component?: DebugReadiness }) {
  const isDeferred = group.result === "waiting" && group.waitUntil != null;
  const tap = group.videoTime;
  const now = run?.playback.videoTime ?? tap;
  const end = group.waitUntil ?? tap;
  const progress = end > tap ? Math.max(0, Math.min(100, ((now - tap) / (end - tap)) * 100)) : 0;
  return <section className={styles.whyCard} data-result={group.result}>
    <h3><DebugIcon name={group.result === "failed" || group.result === "unavailable" ? "close" : group.result === "waiting" ? "clock" : group.result === "done" ? "check" : "warn"} size={13} />What this means</h3>
    <p>{group.why}</p>
    {component?.failure && group.result === "unavailable" && <pre className={styles.errorText}>{component.failure}</pre>}
    {isDeferred && <div className={styles.deferredBar} aria-label={`Tap at ${formatVideoTime(tap)}, now ${formatVideoTime(now, true)}, layer ends ${formatVideoTime(end)}`}>
      <span><i style={{ width: `${progress}%` }} /></span>
      <small>{formatVideoTime(tap)} tap · now {formatVideoTime(now, true)} · {formatVideoTime(end)} layer ends</small>
    </div>}
    {group.nextStep && <p className={styles.nextStep}>Next step · {group.nextStep}</p>}
  </section>;
}

export function InteractionDetails({ group, run, readiness, requests, density, componentFilter, onFilterComponent, onBack, onEditComponent, onLocate }: InteractionDetailsProps) {
  if (!group) return <section className={styles.readinessPane}>
    <header className={styles.detailHeader}><span className={styles.readinessTile}><DebugIcon name="sparkle" size={14} /></span><span><h2>Components in {run?.playback.sceneName || "this scene"}</h2><small>Checked when Try started · pick one to filter the activity</small></span></header>
    <ReadinessList components={readiness} activeId={componentFilter} onSelect={onFilterComponent} density={density} overflow={run?.componentOverflow} />
  </section>;

  const component = readiness.find(item => item.id === group.componentId);
  const request = [...requests].reverse().find(item => item.groupId === group.id);
  const changed = Boolean(component && group.source?.revision && component.currentRevision !== group.source.revision);
  const usedLastValid = Boolean(group.source?.lastValid);
  const editable = Boolean(group.componentId && component);
  const editTab = component?.code && group.result !== "no_action" ? "logic" : "action";
  const inputReceived = group.records.some(record => record.type === "interaction.received");
  const timeLabel = `${group.kind === "playback" ? "Playback" : "Run"} · ${inputReceived ? "tap at" : "at"} ${formatVideoTime(group.videoTime)}`;
  return <section className={styles.interactionDetail} data-density={density}>
    {density === "desktop" && <div className={styles.desktopBackRow}><button type="button" className={styles.backButton} onClick={onBack}><DebugIcon name="back" size={18} />Back to activity</button></div>}
    {density === "mobile" && <div className={styles.backRow}>
      <button type="button" className={styles.backButton} onClick={onBack} aria-label="Back to activity"><DebugIcon name="back" size={18} /></button>
      <span><h2>{group.componentName}{group.target ? ` › ${group.target}` : ""}</h2><small>{timeLabel}</small></span>
    </div>}
    {density === "desktop" && <header className={styles.detailHeader}>
      <span className={styles.readinessTile}><DebugIcon name={component?.code ? "code" : group.kind === "playback" ? "pause" : "sparkle"} size={15} /></span>
      <span className={styles.detailTitle}><h2>{group.componentName}{group.target ? ` › ${group.target}` : ""}</h2><small>{timeLabel}</small></span>
      <ResultChip result={group.result} label={group.resultLabel} large />
      {editable && <button type="button" className={styles.secondaryButton} onClick={() => onLocate(group.componentId!)}><DebugIcon name="locate" size={14} />Locate</button>}
      {editable && <button type="button" className={styles.primaryButton} onClick={() => onEditComponent(group.componentId!, editTab)}>{run?.status === "running" ? "Stop and edit" : "Open component"} →</button>}
    </header>}
    {density === "mobile" && <div className={styles.mobileResult}><ResultChip result={group.result} label={group.resultLabel} large /></div>}
    {(changed || usedLastValid) && <p className={styles.changedBanner}>
      {usedLastValid && "This run used the last valid source; your draft was not executed. "}
      {changed && "Current source differs from what ran in this Try. "}
      {group.source?.revision && `Ran revision ${group.source.revision}.`}
    </p>}
    <div className={styles.detailBody}>
      <StageList stages={group.stages} density={density} />
      <div className={styles.detailRight}>
        <WhyCard group={group} run={run} component={component} />
        <FactList group={group} component={component} request={request} />
      </div>
      {density === "mobile" && editable && <div className={styles.mobileActions}>
        <button type="button" className={styles.primaryButton} onClick={() => onEditComponent(group.componentId!, editTab)}>{run?.status === "running" ? "Stop and edit" : "Open component"} →</button>
        <button type="button" className={styles.secondaryButton} onClick={() => onLocate(group.componentId!)}><DebugIcon name="locate" size={15} />Locate</button>
      </div>}
    </div>
  </section>;
}
