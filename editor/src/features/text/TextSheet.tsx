import { useCapture } from "../../state/captureStore";
import { Shell } from "../../ui/SheetShell";
import { TextEditor } from "./TextEditor";

export function TextSheet() {
  const editing = useCapture(s => s.selText != null);
  return <Shell title={editing ? "Edit text" : "Add text"} sub="Your words, your design · drag on the preview to position"><TextEditor /></Shell>;
}
