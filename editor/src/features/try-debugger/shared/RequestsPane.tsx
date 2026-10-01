import { useEffect, useRef, type KeyboardEvent } from "react";
import type { DebugRequestRow } from "../../../domain/debugging/types";
import { DebugIcon } from "./DebugIcon";
import { formatElapsed, formatVideoTime } from "./format";
import { ResultChip } from "./ResultChip";
import styles from "../TryDebugger.module.css";

type RequestsPaneProps = {
  requests: DebugRequestRow[];
  selectedId: string | null;
  density: "desktop" | "mobile";
  captureData: boolean;
  canCapture: boolean;
  failedOnly: boolean;
  onToggleFailedOnly: () => void;
  onSelect: (id: string) => void;
  onKeyboardSelect?: (id: string) => void;
  onBack?: () => void;
  onToggleCapture: () => void;
  onShowActivity: (groupId: string) => void;
};

export function RequestList({ requests, selectedId, density, failedOnly, onToggleFailedOnly, onSelect, onKeyboardSelect, overflow = 0 }: Pick<RequestsPaneProps,
  "requests" | "selectedId" | "density" | "failedOnly" | "onToggleFailedOnly" | "onSelect" | "onKeyboardSelect"> & { overflow?: number }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>("[aria-selected='true']");
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);
  const visible = failedOnly ? requests.filter(request => ["failed", "blocked", "unavailable"].includes(request.result)) : requests;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && density === "desktop") {
      const current = event.currentTarget.querySelector<HTMLButtonElement>("[data-debug-request]:focus");
      if (current?.dataset.requestId) { event.preventDefault(); onSelect(current.dataset.requestId); }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-debug-request]"));
    if (buttons.length === 0) return;
    const current = buttons.findIndex(button => button === document.activeElement);
    const next = event.key === "ArrowDown" ? Math.min(buttons.length - 1, current + 1)
      : Math.max(0, current < 0 ? buttons.length - 1 : current - 1);
    buttons[next]?.focus();
    if (buttons[next]?.dataset.requestId) onKeyboardSelect?.(buttons[next].dataset.requestId);
    event.preventDefault();
  };
  return <div className={styles.requestsList} ref={listRef} role="listbox" aria-label="Requests in this run" data-density={density} onKeyDown={onKeyDown}>
    {overflow > 0 && <div className={styles.omissionNote}>{overflow} older request{overflow === 1 ? "" : "s"} omitted from this bounded view.</div>}
    {density === "mobile" && requests.length > 0 && <div className={styles.requestFilterRow}>
      <button type="button" className={styles.filterButton} data-active={failedOnly} aria-pressed={failedOnly} onClick={onToggleFailedOnly}><DebugIcon name="warn" size={12} />Failed only</button>
      <span>{requests.length} request{requests.length === 1 ? "" : "s"}</span>
    </div>}
    {visible.map(request => <button key={request.id} type="button" role="option" data-debug-request data-request-id={request.id} className={styles.requestRow}
      data-density={density} aria-selected={selectedId === request.id} onClick={() => onSelect(request.id)}>
      <span className={styles.methodPill}>{request.method}</span>
      <code className={styles.requestPath}>{request.path}</code>
      <ResultChip result={request.result} label={request.resultLabel} />
      <small>{request.componentName} · {request.host} · started {formatVideoTime(request.videoTime)}{request.durationMs != null ? ` · ${formatElapsed(request.durationMs)}` : ""}</small>
      {density === "mobile" && <DebugIcon name="chevron" size={14} className={styles.requestChevron} />}
    </button>)}
    {visible.length === 0 && <div className={styles.emptyCard}>{requests.length === 0 ? "No requests in this run yet." : "No failed requests match this filter."}</div>}
  </div>;
}

export function RequestDetails({ request, density, captureData, canCapture, onBack, onToggleCapture, onShowActivity }: {
  request: DebugRequestRow | null;
  density: "desktop" | "mobile";
  captureData: boolean;
  canCapture: boolean;
  onBack?: () => void;
  onToggleCapture: () => void;
  onShowActivity: (groupId: string) => void;
}) {
  if (!request) return <div className={styles.emptyCard}>Select a request to see what's known about it.</div>;
  const facts: Array<[string, string]> = [
    ["Method", request.method],
    ["Destination", `${request.host}${request.path}`],
    ["Started", `${formatVideoTime(request.videoTime)} video time`],
    ["Elapsed", request.durationMs == null ? "Still running" : formatElapsed(request.durationMs)],
    ["HTTP status", request.status == null ? "No status recorded" : String(request.status)],
    ["Started by", request.componentName],
    ["Request policy", request.result === "blocked" ? "Rejected before sending" : "No policy rejection recorded"],
  ];
  return <section className={styles.requestDetails} data-density={density}>
    {density === "desktop" && <div className={styles.desktopBackRow}><button type="button" className={styles.backButton} onClick={onBack}><DebugIcon name="back" size={18} />Back to requests</button></div>}
    {density === "mobile" && <div className={styles.backRow}>
      <button type="button" className={styles.backButton} onClick={onBack} aria-label="Back to requests"><DebugIcon name="back" size={18} /></button>
      <span><h2>{request.method} {request.path}</h2><small>{request.componentName} · {request.host}</small></span>
    </div>}
    {density === "desktop" && <header className={styles.detailHeader}>
      <span className={styles.methodPill}>{request.method}</span>
      <span className={styles.detailTitle}><h2>{request.path}</h2><small>{request.componentName} · {request.host}</small></span>
      <ResultChip result={request.result} label={request.resultLabel} large />
      <button type="button" className={styles.secondaryButton} onClick={() => onShowActivity(request.groupId)}>Show in Activity</button>
    </header>}
    <div className={styles.requestDetailBody}>
      <div className={styles.detailRight}>
        <section className={styles.whyCard} data-result={request.result}>
          <h3><DebugIcon name={request.result === "failed" ? "close" : request.result === "running" ? "clock" : "check"} size={13} />{request.resultLabel}</h3>
          <p>{request.explanation}</p>
        </section>
        <section className={styles.dataCard}>
          <h3>{request.captured ? "Data captured" : "Data not captured"}</h3>
          <p>{request.captured ? "Bounded data was captured for this request. Private values and secrets stay masked; reports contain metadata only." : captureData ? "This request started before capture was on, so its data wasn't kept." : canCapture ? "Only request metadata was kept. Turn Capture data on for new activity in this run." : "Only request metadata was kept. Capture is available during Try."}</p>
          {request.captured && request.requestBody !== undefined && <div className={styles.capturedBlock}><strong>Request data</strong><pre>{JSON.stringify(request.requestBody, null, 2)}</pre></div>}
          {request.captured && request.responseBody !== undefined && <div className={styles.capturedBlock}><strong>Response data</strong><pre>{JSON.stringify(request.responseBody, null, 2)}</pre></div>}
          <button type="button" disabled={!canCapture} onClick={onToggleCapture}>{canCapture ? captureData ? "Turn capture off" : "Capture data for new activity" : "Capture unavailable after Stop"}</button>
        </section>
      </div>
      <dl className={styles.factList}>{facts.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
      {density === "mobile" && <button type="button" className={styles.secondaryButton} onClick={() => onShowActivity(request.groupId)}>Show in Activity</button>}
    </div>
  </section>;
}
