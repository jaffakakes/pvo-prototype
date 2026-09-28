import { useCapture } from "../../state/captureStore";
import { Picker } from "./Picker";
import { EditorSheet } from "./fields/EditorSheet";

export function ComponentsSheets() {
  const sheet = useCapture(s => s.sheet);
  if (sheet === "components") return <Picker />;
  if (sheet === "component") return <EditorSheet />;
  return null;
}
