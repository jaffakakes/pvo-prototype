type HomeState = {
  recording: boolean;
  importing: boolean;
  ex: "idle" | "running" | "done";
  currentSceneId: string;
  startRecordingIntoScene: (id: string) => void;
};

/** Applied once after recovery; home navigation never resets restored footage. */
export function enterCameraHome(requested: boolean, mobile: boolean, state: HomeState): boolean {
  if (!requested || !mobile || state.recording || state.importing || state.ex === "running") return false;
  state.startRecordingIntoScene(state.currentSceneId);
  return true;
}
