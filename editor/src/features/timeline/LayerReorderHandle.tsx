import { useGestureCancellation } from "./useGestureCancellation";
import { useRef, type CSSProperties, type ReactNode } from "react";
import type { LayerId } from "../../domain/layers/model";
import { selectTimelineLayer } from "../../state/editing/layerSelection";
import type { useLayerDrag } from "./useLayerDrag";

export function LayerReorderHandle({
  id,
  label,
  drag,
  children,
  className,
  style,
  selected,
  disabled,
  kind,
  rowId,
}: {
  id: LayerId;
  label: string;
  drag: ReturnType<typeof useLayerDrag>;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  selected?: boolean;
  disabled?: boolean;
  kind?: string;
  rowId?: string;
}) {
  const owner = useRef<{
    pointerId: number;
    element: HTMLButtonElement;
  } | null>(null);
  const cancel = () => {
    const active = owner.current;
    if (!active) return false;
    owner.current = null;
    drag.end(true);
    if (active.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
    return true;
  };
  useGestureCancellation(cancel);
  return (
    <button
      type="button"
      className={className}
      style={style}
      disabled={disabled}
      data-reorder-layer={id}
      data-layer-id={id}
      data-kind={kind}
      data-desktop-layer-label={rowId}
      data-sel={selected}
      title="Drag up or down to reorder · Alt + ↑ / ↓"
      aria-label={label}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.button > 0 || disabled) return;
        owner.current = {
          pointerId: event.pointerId,
          element: event.currentTarget,
        };
        selectTimelineLayer(id);
        drag.begin(id, event, true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        drag.move(event);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        owner.current = null;
        drag.end();
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        owner.current = null;
        drag.end(true);
      }}
      onLostPointerCapture={(event) => {
        if (event.target === event.currentTarget) {
          owner.current = null;
          drag.end(true);
        }
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.detail === 0) selectTimelineLayer(id);
      }}
    >
      {children}
    </button>
  );
}
