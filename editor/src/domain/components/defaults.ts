import type { ComponentFields, ComponentType } from "../project/model";

export const defaultFields = (type: ComponentType): ComponentFields => {
  if (type === "tooltip")
    return { text: "Swipe up for sizes" };
  if (type === "card")
    return { title: "New message", body: "Add a line of text.", buttons: [{ label: "Got it", outcome: { kind: "continue" } }] };
  if (type === "choice")
    return { prompt: "Which one?", options: [
        { label: "Option A", outcome: { kind: "continue" } },
        { label: "Option B", outcome: { kind: "continue" } },
      ] };
  return {
    heading: "Get early access", formFields: [{ name: "Name", type: "text" }, { name: "Email", type: "text" }],
    submitLabel: "Continue", formSubmitMode: "local", outcome: { kind: "continue" }, destination: "", waitingLabel: "Sending…",
    successOutcome: { kind: "continue" }, failureOutcome: null,
  };
};
