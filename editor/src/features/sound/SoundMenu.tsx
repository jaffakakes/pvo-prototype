import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import styles from "./SoundMenu.module.css";

export function SoundMenu({ disabled }: { disabled: boolean }) {
  const sound = useCapture((state) => state.sound);
  const [position, setPosition] = useState<{
    bottom: number;
    right: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setPosition(null);
    };
    const close = () => setPosition(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
    };
  }, [position]);
  const choices = [
    [
      sound > 0 ? "replace" : "plus",
      sound > 0 ? "Replace" : "Add sound",
      "sound",
    ],
    ["music", "Sound effect", "soundEffects"],
    ["microphone", "Voiceover", "voiceover"],
  ] as const;
  return (
    <>
      <button
        ref={trigger}
        className={cx("tool tool-sound")}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={!!position}
        onClick={() => {
          const rect = trigger.current!.getBoundingClientRect();
          setPosition(
            position
              ? null
              : {
                  bottom: innerHeight - rect.top + 14,
                  right: Math.max(12, innerWidth - rect.right),
                },
          );
        }}
      >
        <Icon name="music" size={20} />
        <span>Sound</span>
      </button>
      {position &&
        createPortal(
          <div
            ref={menu}
            className={styles.menu}
            style={position}
            role="menu"
            aria-label="Sound"
            onKeyDown={(event) => {
              const buttons = [...menu.current!.querySelectorAll("button")];
              if (event.key === "Escape" || event.key === "Tab") {
                setPosition(null);
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  trigger.current?.focus();
                }
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const index = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                buttons[
                  (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                    buttons.length
                ].focus();
              }
            }}
          >
            {choices.map(([icon, label, sheet]) => (
              <button
                role="menuitem"
                key={sheet}
                onClick={() => {
                  setPosition(null);
                  useCapture.getState().patch({
                    sheet,
                    sel: -1,
                    selText: null,
                    selComp: null,
                    selAudio: null,
                    playing: false,
                    orb: false,
                  });
                }}
              >
                <Icon name={icon} size={18} />
                <span>{label}</span>
              </button>
            ))}
          </div>,
          document.querySelector(".app") ?? document.body,
        )}
    </>
  );
}
