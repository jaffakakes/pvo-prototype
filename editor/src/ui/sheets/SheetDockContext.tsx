import { createContext, useContext } from "react";

export type SheetDockContextValue = {
  expanded: boolean;
  setExpanded(expanded: boolean): void;
  registerDismiss(
    handler: () => void,
    options?: { disabled?: boolean },
  ): () => void;
  dismissFromTransport?: () => void;
  dismissDisabled?: boolean;
  setTextInputFocused?: (focused: boolean) => void;
  assistantActive?: boolean;
  registerAssistantTarget?: (target: HTMLDivElement | null) => void;
};

export const SheetDockContext = createContext<SheetDockContextValue | null>(
  null,
);

export function useSheetDock() {
  return useContext(SheetDockContext);
}
