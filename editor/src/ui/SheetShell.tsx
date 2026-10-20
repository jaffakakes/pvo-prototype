import { useCallback, useEffect } from "react";
import { useCapture } from "../state/captureStore";
import { cx } from "../styles";
import { Icon } from "./Icon";
import { useSheetDock } from "./sheets/SheetDockContext";
import dockedStyles from "./sheets/DockedSheet.module.css";

export function Shell({
  title,
  children,
  actions,
  headerless = false,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  headerless?: boolean;
}) {
  const close = useCallback(
    () => useCapture.getState().patch({ sheet: null }),
    [],
  );
  const dock = useSheetDock();
  const registerDismiss = dock?.registerDismiss;
  const picking = useCapture((s) => !!s.playheadPick);
  useEffect(
    () => (!headerless ? registerDismiss?.(close) : undefined),
    [registerDismiss, close, headerless],
  );
  const transportClose = !!dock?.dismissFromTransport;

  return (
    <>
      {!dock && !picking && (
        <div className={cx("sheetScrim")} onClick={close} />
      )}
      <section
        className={`${cx("sheet")} ${dock ? dockedStyles.docked : ""}`}
        style={picking ? { display: "none" } : undefined}
        data-docked={dock ? "true" : undefined}
        role="dialog"
        aria-modal={dock ? undefined : true}
        aria-label={title}
      >
        {!dock && !headerless && <div className={cx("grabber")} />}
        {!headerless && (!transportClose || actions) && (
          <header
            className={`${cx("sheetHead")} ${dock ? dockedStyles.header : ""}`}
          >
            {actions}
            {!transportClose && (
              <button
                className={cx("sheetClose")}
                onClick={close}
                aria-label="Close"
              >
                <Icon name="close" size={17} />
              </button>
            )}
          </header>
        )}
        {dock ? (
          <div
            className={`${dockedStyles.body} ${headerless ? dockedStyles.compactBody : ""}`}
            data-sheet-body
          >
            {children}
          </div>
        ) : (
          children
        )}
      </section>
    </>
  );
}
