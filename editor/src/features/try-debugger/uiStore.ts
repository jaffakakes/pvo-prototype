import { create } from "zustand";

export type DebugTab = "activity" | "state" | "requests";
export type DebugOverlay = "components" | "report" | "menu" | null;
export type MobileDebugView = "list" | "detail" | "components" | "requestDetail";

type DebugUiState = {
  runId: string | null;
  open: boolean;
  tab: DebugTab;
  selectedGroupId: string | null;
  selectedRequestId: string | null;
  componentId: string;
  issuesOnly: boolean;
  requestsFailedOnly: boolean;
  followLatest: boolean;
  pinnedPaths: string[];
  overlay: DebugOverlay;
  mobileView: MobileDebugView;
  feedback: string | null;
  cleared: boolean;
};

const initial: DebugUiState = {
  runId: null,
  open: false,
  tab: "activity",
  selectedGroupId: null,
  selectedRequestId: null,
  componentId: "all",
  issuesOnly: false,
  requestsFailedOnly: false,
  followLatest: true,
  pinnedPaths: ["score"],
  overlay: null,
  mobileView: "list",
  feedback: null,
  cleared: false,
};

// The UI state is independent from the run collector and from project history.
// A mounted desktop/mobile workspace can change without losing the inspection view.
export const useDebugUi = create<DebugUiState>(() => ({ ...initial }));

export function setDebugOpen(open: boolean) {
  useDebugUi.setState({ open, overlay: null, mobileView: "list", feedback: null });
}

export function resetDebugUiForRun(runId: string) {
  const current = useDebugUi.getState();
  if (current.runId === runId) return;
  useDebugUi.setState({ ...initial, runId, open: current.open });
}

export function markDebugRunStopped() {
  useDebugUi.setState({ followLatest: false });
}

export function setDebugTab(tab: DebugTab) {
  useDebugUi.setState({ tab, mobileView: "list", overlay: null });
}

export function selectDebugGroup(id: string) {
  useDebugUi.setState({ selectedGroupId: id, mobileView: "detail", overlay: null });
}

export function selectDebugRequest(id: string) {
  useDebugUi.setState({ selectedRequestId: id, mobileView: "requestDetail", overlay: null });
}

export function setDebugComponentFilter(componentId: string) {
  useDebugUi.setState({ componentId, mobileView: "list", overlay: null });
}

export function toggleDebugPin(path: string) {
  useDebugUi.setState(state => {
    if (state.pinnedPaths.includes(path)) {
      return { pinnedPaths: state.pinnedPaths.filter(item => item !== path) };
    }
    if (state.pinnedPaths.length >= 4) {
      return { feedback: "You can watch up to 4 values." };
    }
    return { pinnedPaths: [...state.pinnedPaths, path] };
  });
}

export function showDebugFeedback(message: string) {
  useDebugUi.setState({ feedback: message });
}
