import { useCallback, useEffect } from "react";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import { useSheetDock } from "../../ui/sheets/SheetDockContext";
import dockedStyles from "../../ui/sheets/DockedSheet.module.css";

export function SheetFrame({ title, sub, icon, onBack, onReset, onDelete, onClose, className, fullScreen, fillBody, disabled, doneLabel, navigation, children }: {
  title: string; sub: string; icon?: string; onBack?: () => void; onReset?: () => void; onDelete?: () => void;
  onClose?: () => void; className?: string; fullScreen?: boolean; fillBody?: boolean; doneLabel?: string; children: React.ReactNode;
  navigation?: React.ReactNode; disabled?: boolean;
}) {
  const closeSheet = useCallback(() => useCapture.getState().patch({ sheet: null }), []);
  const close = onClose ?? closeSheet;
  const dock = useSheetDock();
  const registerDismiss = dock?.registerDismiss;
  const dismiss = onClose ?? onBack ?? closeSheet;
  const picking = useCapture(s => !!s.playheadPick);
  useEffect(() => registerDismiss?.(dismiss), [registerDismiss, dismiss]);

  return <>{!dock && !picking && <div className={cx("sheetScrim")} onClick={close} />}<section
    className={`${cx("sheet componentSheet")} ${className ?? ""} ${dock ? dockedStyles.docked : ""}`}
    style={picking ? { display: "none" } : undefined}
    data-code-fullscreen={!dock && fullScreen || undefined}
    data-docked={dock ? "true" : undefined}
    data-code-expanded={!!dock?.expanded && !!fillBody}
    role="dialog"
    aria-modal={dock ? undefined : true}
    aria-label={title}
  >
    {!dock && <div className={cx("grabber")} />}
    <header className={`${cx("sheetHead")} ${dock ? dockedStyles.header : ""}`} {...(disabled ? { inert: "" } : {})}>
      {onBack && <button className={cx("sheetClose")} onClick={onBack} aria-label="Back"><Icon name="back" size={17} /></button>}
      {icon && <span className={cx("componentTypeGlyph")}><Icon name={icon} size={20} /></span>}
      <div style={{ flex: 1, minWidth: 0 }}><h2>{title}</h2><p>{sub}</p></div>
      {onReset && <button className={cx("sheetClose")} onClick={onReset} aria-label="Reset to fields" title="Reset to fields"><Icon name="reset" size={17} /></button>}
      {onDelete && <button className={cx("sheetClose")} onClick={onDelete} aria-label="Delete component" style={{ color: "var(--red)" }}><Icon name="delete" size={17} /></button>}
      <button className={`${cx("sheetClose")} ${doneLabel ? dockedStyles.done : ""}`} onClick={close} aria-label={doneLabel ?? "Close"}>{doneLabel ?? <Icon name="close" size={17} />}</button>
    </header>
    {navigation}
    {dock ? <div className={`${dockedStyles.body} ${fillBody ? dockedStyles.fillingBody : ""}`} data-sheet-body>{children}</div> : children}
  </section></>;
}
