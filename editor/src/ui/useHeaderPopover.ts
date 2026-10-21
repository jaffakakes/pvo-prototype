import { useCallback, useEffect, useRef, useState } from "react";

type Position = { top: number; left: number };
/** Shared header anchoring, outside dismissal and focus ownership. */
export function useHeaderPopover(
  width: number,
  align: "start" | "end" = "start",
) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const close = useCallback((restoreFocus = false) => {
    setPosition(null);
    if (restoreFocus) trigger.current?.focus();
  }, []);
  const open = () => {
    const button = trigger.current!;
    const header = button.closest("header")!.getBoundingClientRect();
    const anchor = (
      align === "end" ? button : button.parentElement!
    ).getBoundingClientRect();
    const actualWidth = Math.min(width, innerWidth - 20);
    const left = align === "end" ? anchor.right - actualWidth : anchor.left;
    setPosition({
      top: header.bottom + 4,
      left: Math.max(10, Math.min(left, innerWidth - actualWidth - 10)),
    });
  };
  useEffect(() => {
    if (!position) return;
    (
      panel.current?.querySelector<HTMLElement>('[role="menuitem"]') ??
      panel.current?.querySelector<HTMLElement>("button, a[href], input")
    )?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        close();
    };
    const dismiss = () => close();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("popstate", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("popstate", dismiss);
    };
  }, [position, close]);
  return { trigger, panel, position, open, close };
}
