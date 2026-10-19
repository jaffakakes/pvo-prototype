import { useEffect, useMemo, useRef, useState } from "react";
import type { Scene } from "../../domain/project/model";
import { sceneGraph } from "../../domain/scenes/graph";
import {
  readScenesView,
  saveScenesView,
  type ScenesView,
} from "../../infrastructure/preferences/scenesView";
import { useCapture } from "../../state/captureStore";
import { createSceneBranch } from "../../state/scenes/createSceneBranch";
import { Icon } from "../../ui/Icon";
import { SceneTreeList } from "./SceneTreeList";
import { SceneMap } from "./SceneMap";
import styles from "./ScenesPanel.module.css";

type Props = {
  id: string;
  scenes: Scene[];
  currentSceneId: string;
  onClose(): void;
  onSelect(id: string, keepOpen?: boolean): void;
};

export function SceneTree({
  id,
  scenes,
  currentSceneId,
  onClose,
  onSelect,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<ScenesView>(readScenesView);
  const nodes = useMemo(() => sceneGraph(scenes), [scenes]);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);
  const chooseView = (next: ScenesView) => {
    setView(next);
    saveScenesView(next);
  };
  const add = () => {
    createSceneBranch();
    onClose();
  };
  return (
    <section
      id={id}
      className={`sceneTree ${styles.panel}`}
      aria-label="Scene tree"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className={styles.header}>
        <h2>Scenes</h2>
        <div
          className={styles.switch}
          role="radiogroup"
          aria-label="Scenes view"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = view === "tree" ? "map" : "tree";
            chooseView(next);
            event.currentTarget
              .querySelector<HTMLButtonElement>(`[data-view="${next}"]`)
              ?.focus();
          }}
        >
          {(["tree", "map"] as const).map((value) => (
            <button
              key={value}
              role="radio"
              data-view={value}
              tabIndex={value === view ? 0 : -1}
              aria-checked={value === view}
              onClick={() => chooseView(value)}
            >
              {value === "tree" ? "Tree" : "Map"}
            </button>
          ))}
        </div>
        <button
          ref={closeRef}
          className={styles.close}
          onClick={onClose}
          aria-label="Close scene tree"
        >
          <Icon name="close" size={12} />
        </button>
      </header>
      {view === "tree" ? (
        <SceneTreeList
          nodes={nodes}
          currentId={currentSceneId}
          onOpen={onSelect}
          onAdd={add}
          onManage={(id) => {
            onSelect(id);
            useCapture.getState().patch({ sheet: "more", playing: false });
          }}
        />
      ) : (
        <SceneMap
          nodes={nodes}
          currentId={currentSceneId}
          onCenter={(id) => onSelect(id, true)}
          onAdd={add}
          onChoice={(id) => {
            const source = scenes.find((scene) =>
              scene.components.some((component) => component.id === id),
            );
            if (!source) return;
            onSelect(source.id);
            useCapture
              .getState()
              .patch({ selComp: id, sheet: "component", playing: false });
          }}
        />
      )}
    </section>
  );
}
