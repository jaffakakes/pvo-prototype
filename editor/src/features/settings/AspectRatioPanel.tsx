import { useCallback, useEffect, useRef } from "react";
import type { Ratio } from "../../domain/project/model";
import { RATIOS } from "../../domain/project/ratio";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { useSheetDock } from "../../ui/sheets/SheetDockContext";
import styles from "./AspectRatioPanel.module.css";
import { socialIcons } from "./socialIcons";

export function AspectRatioPanel() {
  const ratio = useCapture((state) => state.ratio);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(
    () => useCapture.getState().patch({ sheet: null }),
    [],
  );
  const registerDismiss = useSheetDock()?.registerDismiss;
  useEffect(() => registerDismiss?.(close), [registerDismiss, close]);
  useEffect(() => {
    panel.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus();
    return () => {
      if (document.activeElement === document.body)
        document.querySelector<HTMLButtonElement>(".tool-ratio")?.focus();
    };
  }, []);
  return (
    <div
      ref={panel}
      className={`${cx("toolBar")} ${styles.panel}`}
      role="dialog"
      aria-label="Aspect ratio"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className={styles.options} role="group" aria-label="Video ratio">
        {(Object.keys(RATIOS) as Ratio[]).map((option) => {
          const [width, height] = RATIOS[option];
          const scale = 60 / Math.max(width, height);
          const selected = ratio === option;
          return (
            <button
              type="button"
              key={option}
              aria-pressed={selected}
              onClick={() => {
                if (ratio !== option)
                  useCapture.getState().edit({ ratio: option });
              }}
            >
              <span className={styles.graphic} aria-hidden="true">
                <svg viewBox="0 0 80 80">
                  <rect
                    className={styles.tile}
                    x={(80 - width * scale) / 2}
                    y={(80 - height * scale) / 2}
                    width={width * scale}
                    height={height * scale}
                    rx="8"
                  />
                  {selected && (
                    <rect
                      className={styles.selected}
                      x={(80 - width * scale) / 2 - 4}
                      y={(80 - height * scale) / 2 - 4}
                      width={width * scale + 8}
                      height={height * scale + 8}
                      rx="11"
                    />
                  )}
                  <svg
                    x="28"
                    y="28"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path
                      d={
                        option === "9:16"
                          ? socialIcons.tiktok
                          : option === "16:9"
                            ? socialIcons.youtube
                            : socialIcons.instagram
                      }
                    />
                  </svg>
                </svg>
              </span>
              <span>{option}</span>
            </button>
          );
        })}
      </div>
      <footer className={styles.footer}>
        <span>Ratio</span>
      </footer>
    </div>
  );
}
