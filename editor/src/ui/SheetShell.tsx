import { useCallback, useEffect } from "react";
import { useCapture } from "../state/captureStore";
import { cx } from "../styles";
import { Icon } from "./Icon";
import { useSheetDock } from "./sheets/SheetDockContext";
import dockedStyles from "./sheets/DockedSheet.module.css";

export function Shell({ title, sub, children, actions }: { title: string; sub: string; children: React.ReactNode; actions?: React.ReactNode }) {
  const close = useCallback(() => useCapture.getState().patch({ sheet: null }), []);
  const dock = useSheetDock();
  const registerDismiss = dock?.registerDismiss;
  const picking = useCapture(s => !!s.playheadPick);
  useEffect(() => registerDismiss?.(close), [registerDismiss, close]);

  return <>{!dock && !picking && <div className={cx("sheetScrim")} onClick={close} />}<section
    className={`${cx("sheet")} ${dock ? dockedStyles.docked : ""}`}
    style={picking ? { display: "none" } : undefined}
    data-docked={dock ? "true" : undefined}
    role="dialog"
    aria-modal={dock ? undefined : true}
    aria-label={title}
  >
    {!dock && <div className={cx("grabber")} />}
    <header className={`${cx("sheetHead")} ${dock ? dockedStyles.header : ""}`}><div><h2>{title}</h2><p>{sub}</p></div>{actions}<button className={cx("sheetClose")} onClick={close} aria-label="Close"><Icon name="close" size={17} /></button></header>
    {dock ? <div className={dockedStyles.body} data-sheet-body>{children}</div> : children}
  </section></>;
}
