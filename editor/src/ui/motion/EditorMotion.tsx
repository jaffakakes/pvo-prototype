import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useEditorPreferences } from "../../state/preferences/editorPreferences";
import "./editorMotion.css";

type Transition = (
  subject: "tool" | "component" | "frame",
  change: () => void,
  direction?: "open" | "close",
) => void | Promise<void>;
const MotionContext = createContext<Transition>((_, change) => change());

/** Own navigation snapshots only; authored animation and direct manipulation stay live. */
export function EditorMotionProvider({ children }: { children: ReactNode }) {
  const active = useRef<ViewTransition | null>(null);
  const transition = useCallback<Transition>(
    (subject, change, direction = "open") => {
      active.current?.skipTransition();
      const reduced =
        useEditorPreferences.getState().reduceMotion ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!document.startViewTransition) {
        change();
        return;
      }
      const root = document.documentElement;
      root.dataset.editorMotion = subject;
      root.dataset.editorMotionDirection = direction;
      root.dataset.editorMotionReduced = String(reduced);
      const next = document.startViewTransition(() => flushSync(change));
      active.current = next;
      // A superseding transition skips its animation, never the requested edit.
      void next.ready.catch(() => {});
      const finish = () => {
        if (active.current !== next) return;
        active.current = null;
        delete root.dataset.editorMotion;
        delete root.dataset.editorMotionDirection;
        delete root.dataset.editorMotionReduced;
      };
      void next.finished.then(finish, finish);
      void next.updateCallbackDone.catch((error) =>
        console.error("Editor navigation failed", {
          subject,
          direction,
          error,
        }),
      );
      return next.updateCallbackDone.catch(() => {});
    },
    [],
  );
  useEffect(
    () => () => {
      active.current?.skipTransition();
    },
    [],
  );
  return (
    <MotionContext.Provider value={transition}>
      {children}
    </MotionContext.Provider>
  );
}

export function useEditorTransition() {
  return useContext(MotionContext);
}
