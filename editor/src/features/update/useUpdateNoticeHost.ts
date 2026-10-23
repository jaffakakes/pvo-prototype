import { useLayoutEffect, useState } from "react";

/** A modal makes body siblings inert; its release action must join that modal. */
export function useUpdateNoticeHost(visible: boolean): HTMLElement {
  const [host, setHost] = useState<HTMLElement>(() => document.body);

  useLayoutEffect(() => {
    if (!visible) {
      setHost(document.body);
      return;
    }

    const updateHost = () => {
      const modals = Array.from(
        document.querySelectorAll<HTMLDialogElement>("dialog:modal"),
      );
      // Hit testing follows the browser's top-layer order, including nested
      // modals whose DOM order differs from the order they were opened.
      const front = document
        .elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
        ?.closest<HTMLDialogElement>("dialog:modal");
      const focused =
        document.activeElement?.closest<HTMLDialogElement>("dialog:modal");
      const next = front ?? focused ?? modals.at(-1) ?? document.body;
      setHost((previous) => (previous === next ? previous : next));
    };

    const observer = new MutationObserver((records) => {
      const dialogChanged = records.some(
        (record) =>
          record.type === "attributes" ||
          [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches("dialog") || node.querySelector("dialog")),
          ),
      );
      if (dialogChanged) updateHost();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    updateHost();
    return () => observer.disconnect();
  }, [visible]);

  return host;
}
