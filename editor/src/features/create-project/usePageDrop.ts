import { useEffect, useRef, useState } from "react";

export function usePageDrop(onFiles: (files: File[]) => void, disabled: boolean, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const callback = useRef(onFiles);
  callback.current = onFiles;
  useEffect(() => {
    if (!enabled) { setDragging(false); return; }
    let depth = 0;
    const files = (event: DragEvent) => event.dataTransfer?.types.includes("Files");
    const enter = (event: DragEvent) => {
      if (!files(event)) return;
      event.preventDefault();
      depth++;
      if (!disabled) setDragging(true);
    };
    const over = (event: DragEvent) => { if (files(event)) event.preventDefault(); };
    const leave = (event: DragEvent) => {
      if (!files(event)) return;
      if (--depth <= 0) { depth = 0; setDragging(false); }
    };
    const drop = (event: DragEvent) => {
      if (!files(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      if (!disabled) callback.current(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [disabled, enabled]);
  return dragging;
}
