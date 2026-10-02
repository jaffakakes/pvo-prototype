export type NotificationKind = "error" | "warning" | "info" | "success";
type Definition = {
  message: string;
  kind: NotificationKind;
  persistent?: boolean;
  oncePerScope?: boolean;
  reportEachAttempt?: boolean;
  recovery?: string;
  action?: "undoAssistantEdit";
};

/** Only reviewed events may use the global notification surface. */
export const notificationCatalog = {
  splitUnavailable: { message: "Move the playhead inside a clip.", kind: "warning" },
  flashUnavailable: { message: "Flash unavailable.", kind: "info", oncePerScope: true },
  assistantApplied: { message: "Changes applied.", kind: "success", action: "undoAssistantEdit" },
  assistantUnsupported: { message: "Request not supported.", kind: "error", reportEachAttempt: true },
  assistantAdvancedRequired: { message: "Enable Advanced for this logic change.", kind: "info", reportEachAttempt: true },
  assistantNoTarget: { message: "Select a component first.", kind: "info" },
  assistantFailed: { message: "Couldn't prepare that change.", kind: "error", reportEachAttempt: true },
  assistantInvalidRequest: { message: "Please rephrase that request.", kind: "warning", reportEachAttempt: true },
  assistantTooLarge: { message: "Project or request is too large.", kind: "error", reportEachAttempt: true },
  assistantBusy: { message: "AI provider limit reached. Try later.", kind: "warning", reportEachAttempt: true },
  assistantAllowanceExhausted: { message: "AI provider allowance used up.", kind: "warning", reportEachAttempt: true },
  assistantUnavailable: { message: "Assistant unavailable. Try again later.", kind: "error", reportEachAttempt: true },
  assistantTimeout: { message: "Assistant timed out. Try again.", kind: "error", reportEachAttempt: true },
  assistantStale: { message: "Component changed. Try again.", kind: "warning" },
  assistantProjectChanged: { message: "Project changed. Review it and try again.", kind: "warning", reportEachAttempt: true },
  voiceHoldShort: { message: "Hold a little longer.", kind: "warning" },
  voiceUnavailable: { message: "Voice unavailable.", kind: "info" },
  voiceDenied: { message: "Microphone access denied.", kind: "error" },
  voiceNoMicrophone: { message: "No microphone available.", kind: "error" },
  voiceNoSpeech: { message: "Didn't catch that. Try again.", kind: "warning" },
  voiceNetwork: { message: "Voice connection failed.", kind: "error" },
  voiceFailed: { message: "Couldn't start voice.", kind: "error" },
  importFailed: { message: "Some clips couldn't be imported.", kind: "error", persistent: true,
    recovery: "Review the import result in Camera and retry the failed files." },
  recordingFailed: { message: "Recording couldn't be saved.", kind: "error", persistent: true,
    recovery: "Select the affected clip to record it again or remove it." },
  saveFailed: { message: "Couldn't save changes.", kind: "error", persistent: true,
    recovery: "Open the storage issue or More to retry saving." },
  restoreFailed: { message: "Couldn't restore your project.", kind: "error", persistent: true,
    recovery: "Open the storage issue or More to retry recovery. Your saved project is retained." },
  exportFailed: { message: "Export failed. Try again.", kind: "error" },
  tryFailed: { message: "Couldn't start preview.", kind: "error" },
  tryPlaybackFailed: { message: "Preview stopped. Try again.", kind: "error" },
  audioPreviewFailed: { message: "Couldn't play audio.", kind: "error" },
} as const satisfies Record<string, Definition>;

export type NotificationId = keyof typeof notificationCatalog;
export const notificationDefinition = (id: NotificationId): Definition => notificationCatalog[id];
