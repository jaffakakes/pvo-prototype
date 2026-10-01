import { useEffect, useMemo, useState } from "react";
import { componentReadiness, deriveStatus, errorCount, filterGroups, groupInteractions, issueCount, requestRows, stateRows } from "../../domain/debugging/selectors";
import { buildDebugReport, clearCompletedDebugActivity, debugClockNow, setDebugCaptureData, useTryDebugStore } from "../../state/debugging/tryDebugStore";
import { markDebugRunStopped, resetDebugUiForRun, selectDebugGroup, setDebugOpen, setDebugTab, showDebugFeedback, useDebugUi } from "./uiStore";

export function useDebugPanel(onClose: () => void) {
  const run = useTryDebugStore(state => state.run);
  const captureData = useTryDebugStore(state => state.captureData);
  const ui = useDebugUi();
  const [now, setNow] = useState(debugClockNow);
  const groups = useMemo(() => groupInteractions(run), [run]);
  const requests = useMemo(() => requestRows(run), [run]);
  const readiness = useMemo(() => componentReadiness(run), [run]);
  const values = useMemo(() => stateRows(run), [run]);
  const status = useMemo(() => deriveStatus(run, now), [run, now]);
  const visibleGroups = useMemo(() => filterGroups(groups, { componentId: ui.componentId, issuesOnly: ui.issuesOnly }), [groups, ui.componentId, ui.issuesOnly]);
  const selectedGroup = groups.find(group => group.id === ui.selectedGroupId) ?? null;
  const selectedRequest = requests.find(request => request.id === ui.selectedRequestId) ?? null;
  const errors = errorCount(groups);
  const issues = issueCount(groups);
  const holdComponentName = readiness.find(component => component.id === status.holdComponentId)?.name;

  useEffect(() => {
    if (run?.id) resetDebugUiForRun(run.id);
  }, [run?.id]);
  useEffect(() => {
    if (run && run.status !== "running") markDebugRunStopped();
  }, [run?.id, run?.status]);
  useEffect(() => {
    if (run?.status !== "running" || run.pendingRequests === 0) return;
    const timer = window.setInterval(() => setNow(debugClockNow()), 250);
    return () => window.clearInterval(timer);
  }, [run?.status, run?.pendingRequests]);
  useEffect(() => {
    if (!ui.feedback) return;
    const timer = window.setTimeout(() => useDebugUi.setState({ feedback: null }), 4500);
    return () => window.clearTimeout(timer);
  }, [ui.feedback]);

  const close = () => { setDebugOpen(false); onClose(); };
  const toggleCapture = () => {
    if (run?.status !== "running") return;
    setDebugCaptureData(!captureData);
    showDebugFeedback(captureData ? "Capture off · metadata only" : "Capturing data for new activity · secrets stay masked");
  };
  const clearCompleted = () => {
    const count = clearCompletedDebugActivity();
    useDebugUi.setState({ cleared: count > 0, selectedGroupId: null, selectedRequestId: null, overlay: null });
    showDebugFeedback(`Cleared ${count} completed item${count === 1 ? "" : "s"}. Pending work and current state stay.`);
  };
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(buildDebugReport());
      useDebugUi.setState({ overlay: null });
      showDebugFeedback("Report copied · sanitized");
    } catch {
      showDebugFeedback("Copy failed. You can select the report text and copy it manually.");
    }
  };
  const showActivity = (groupId: string) => {
    setDebugTab("activity");
    selectDebugGroup(groupId);
  };
  const selectHold = () => {
    if (!status.holdComponentId) return;
    const group = [...groups].reverse().find(item => item.componentId === status.holdComponentId);
    if (group) showActivity(group.id);
    else {
      setDebugTab("activity");
      useDebugUi.setState({ componentId: status.holdComponentId, mobileView: "list" });
    }
  };
  const resetFilters = () => useDebugUi.setState({ componentId: "all", issuesOnly: false });

  return { run, captureData, ui, groups, requests, readiness, values, status, visibleGroups,
    selectedGroup, selectedRequest, errors, issues, holdComponentName,
    listening: Boolean(run?.status === "running" && groups.every(group => group.kind === "session")),
    filtered: ui.componentId !== "all" || ui.issuesOnly,
    reportText: ui.overlay === "report" ? buildDebugReport() : "",
    close, toggleCapture, clearCompleted, copyReport, showActivity, selectHold, resetFilters };
}
