import { useMemo } from "react";
import type { SceneNode } from "../../domain/scenes/graph";
import { fmt } from "../../ui/formatTime";
import { Icon } from "../../ui/Icon";
import { ScenePoster } from "./ScenePoster";
import { sceneMapLayout } from "./sceneMapLayout";
import { useSceneMapViewport } from "./useSceneMapViewport";
import styles from "./SceneMap.module.css";

type Props = {
  nodes: SceneNode[];
  currentId: string;
  onCenter(id: string): void;
  onChoice(id: string): void;
  onAdd(): void;
};
export function SceneMap({
  nodes,
  currentId,
  onCenter,
  onChoice,
  onAdd,
}: Props) {
  const viewport = useSceneMapViewport(currentId);
  const availableHeight = Math.max(40, viewport.size.height - 36);
  const layout = useMemo(
    () => sceneMapLayout(nodes, currentId, viewport.fit, availableHeight),
    [nodes, currentId, viewport.fit, availableHeight],
  );
  const baseScale = Math.min(1, availableHeight / layout.height);
  const scale = viewport.fit
    ? Math.min(
        0.5,
        (viewport.size.width - 24) / layout.width,
        availableHeight / layout.height,
      )
    : baseScale * viewport.zoom;
  const x = (viewport.size.width - layout.width * scale) / 2 + viewport.pan.x;
  const y =
    Math.max(0, (availableHeight - layout.height * scale) / 2) + viewport.pan.y;
  const current = nodes.find((node) => node.scene.id === currentId)!;
  return (
    <div
      ref={viewport.ref}
      className={styles.viewport}
      data-scene-map
      data-fit={viewport.fit}
      {...viewport.handlers}
    >
      <div
        className={styles.canvas}
        role="group"
        aria-label="Scene connections"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${x}px, ${y}px) scale(${scale})`,
        }}
      >
        <svg
          className={styles.edges}
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          {layout.edges.map((edge, index) => (
            <path key={index} d={edge.path} />
          ))}
        </svg>
        {layout.frame && (
          <button
            className={styles.frame}
            aria-label={`Zoom in on ${current.scene.name}`}
            style={{
              left: layout.frame.x,
              top: layout.frame.y,
              width: layout.frame.width,
              height: layout.frame.height,
            }}
            onClick={() => viewport.changeZoom(1)}
          />
        )}
        {layout.edges
          .filter((edge) => edge.label)
          .map((edge, index) => (
            <span
              key={index}
              className={styles.label}
              style={{ left: edge.x, top: edge.y }}
              title={edge.label}
            >
              {edge.label}
            </span>
          ))}
        {layout.scenes.map(({ node, kind, x, y }) => (
          <button
            key={node.scene.id}
            className={styles.scene}
            data-kind={kind}
            data-map-scene={node.scene.id}
            style={{ left: x, top: y }}
            aria-label={`Centre on ${node.scene.name}`}
            aria-current={node.scene.id === currentId ? "true" : undefined}
            onClick={() => {
              onCenter(node.scene.id);
              viewport.changeZoom(1);
            }}
          >
            <ScenePoster scene={node.scene} />
            <span className={styles.details}>
              <strong>{node.scene.name}</strong>
              {kind !== "parent" && (
                <small>
                  {node.scene.clips.length ? fmt(node.duration) : "empty"}
                  {kind === "current"
                    ? " · here"
                    : node.children.length
                      ? ` · +${node.children.length} more ›`
                      : " · ends"}
                </small>
              )}
            </span>
          </button>
        ))}
        {layout.choices.map((choice) => (
          <button
            key={choice.id}
            className={styles.choice}
            style={{ left: choice.x, top: choice.y }}
            aria-label="Edit choice"
            onClick={() => onChoice(choice.id)}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 2l2.4 5.6L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.6-1.4z" />
            </svg>
          </button>
        ))}
        {layout.ghost && (
          <button
            className={styles.ghost}
            style={{ left: layout.ghost.x, top: layout.ghost.y }}
            onClick={onAdd}
          >
            <Icon name="plus" size={12} />
            Branch
          </button>
        )}
      </div>
      <div className={styles.controls} role="group" aria-label="Map zoom">
        <button
          aria-label="Zoom in"
          onClick={() =>
            viewport.changeZoom(viewport.fit ? 1 : viewport.zoom + 0.5)
          }
        >
          <Icon name="plus" size={12} />
        </button>
        <button aria-label="Fit all scenes" onClick={viewport.fitAll}>
          <Icon name="fullscreen" size={12} />
        </button>
        <button
          aria-label="Zoom out"
          onClick={() => viewport.changeZoom(viewport.zoom - 0.5)}
        >
          <span className={styles.minus} />
        </button>
      </div>
    </div>
  );
}
