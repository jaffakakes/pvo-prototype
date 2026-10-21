import { useEffect, useRef } from "react";
import type { PvoComponent } from "../../domain/project/model";
import { beginComponentLayerGesture } from "../../state/components/componentLayerGesture";

export function useLayerGesture(id: string) {
  const active = useRef<ReturnType<typeof beginComponentLayerGesture>>(null);
  const cancel = () => {
    active.current?.cancel();
    active.current = null;
  };
  const commit = () => {
    active.current?.commit();
    active.current = null;
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && active.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancel();
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [id]);
  return {
    begin() {
      if (!active.current) active.current = beginComponentLayerGesture(id);
    },
    update(changes: Partial<PvoComponent>) {
      if (!active.current) active.current = beginComponentLayerGesture(id);
      if (!active.current?.update(changes)) cancel();
    },
    commit,
    cancel,
  };
}
