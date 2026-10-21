import { useLayoutEffect, useRef, type RefObject } from "react";
import { useEditorPreferences } from "../../state/preferences/editorPreferences";

/** Changing tools fades their controls once; editing values never replays it. */
export function useToolSwap(
  ref: RefObject<HTMLElement | null>,
  tool: string | null,
) {
  const previous = useRef(tool);
  const reduced = useEditorPreferences((state) => state.reduceMotion);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = tool;
    if (!before || !tool || before === tool || !ref.current) return;
    const duration = parseFloat(
      getComputedStyle(ref.current).getPropertyValue("--editor-motion-swap"),
    );
    const animation = ref.current.animate([{ opacity: 0.65 }, { opacity: 1 }], {
      duration: reduced ? 80 : duration,
      easing: "ease-out",
    });
    return () => animation.cancel();
  }, [tool, ref, reduced]);
}
