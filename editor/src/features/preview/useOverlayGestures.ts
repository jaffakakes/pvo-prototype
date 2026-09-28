import { useEffect, useRef, type PointerEvent, type RefObject } from "react";
import type { OverlayTarget, OverlayTransform } from "../../domain/layers/transform";
import { useCapture } from "../../state/captureStore";
import { beginOverlayTransform } from "../../state/editing/overlayTransform";
import { gestureGeometry, type GesturePoint } from "./gestureGeometry";
import type { LookPart } from "../../domain/components/look";
import { selectComponentLookPart } from "../../state/components/componentAuthoringStore";

type Transaction = NonNullable<ReturnType<typeof beginOverlayTransform>>;
type Session = {
  target: OverlayTarget;
  transaction: Transaction;
  points: Map<number, GesturePoint>;
  anchor: ReturnType<typeof gestureGeometry>;
  original: OverlayTransform;
  movable: boolean;
  pinched: boolean;
  moved: boolean;
  part: LookPart | null;
};

function layerTarget(element: Element | null): OverlayTarget | null {
  const id = element?.closest<HTMLElement>("[data-layer-id]")?.dataset.layerId;
  if (id?.startsWith("text:")) return { kind: "text", id: Number(id.slice(5)) };
  if (id?.startsWith("component:")) return { kind: "component", id: id.slice(10) };
  return null;
}

/** Own every contact on the preview so a second finger can land outside the overlay. */
export function useOverlayGestures(boxRef: RefObject<HTMLDivElement>, directSelectionOnly = false) {
  const session = useRef<Session | null>(null);
  const sceneId = useCapture(state => state.currentSceneId);
  const trying = useCapture(state => !!state.tryMode);
  const picking = useCapture(state => !!state.playheadPick);

  const release = (ids: number[]) => {
    const box = boxRef.current;
    for (const id of ids) if (box?.hasPointerCapture(id)) box.releasePointerCapture(id);
  };
  const cancel = () => {
    const current = session.current;
    session.current = null;
    if (!current) return;
    current.transaction.cancel();
    release([...current.points.keys()]);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!session.current || ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      cancel();
    };
    // Finish cancellation before another control can create its own history entry.
    const onOutsidePointer = (event: globalThis.PointerEvent) => {
      if (session.current && !boxRef.current?.contains(event.target as Node)) cancel();
    };
    const onVisibility = () => { if (document.hidden) cancel(); };
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onOutsidePointer, true);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancel();
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onOutsidePointer, true);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sceneId, trying, picking]);

  const rebase = (current: Session) => {
    current.anchor = gestureGeometry([...current.points.values()]);
    current.original = current.transaction.value();
  };
  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (trying || picking || event.button !== 0 || (event.target as Element).closest(".tryPill")) return;
    let current = session.current;
    if (!current) {
      const direct = layerTarget(event.target as Element);
      const state = useCapture.getState();
      const selected: OverlayTarget | null = state.selText != null ? { kind: "text", id: state.selText }
        : state.selComp ? { kind: "component", id: state.selComp } : null;
      const target = direct ?? (directSelectionOnly ? null : selected);
      if (!target || !event.currentTarget.querySelector(`[data-layer-id="${target.kind}:${target.id}"]`)) return;
      state.patch({ ...(target.kind === "text"
        ? { selText: target.id, selComp: null } : { selComp: target.id, selText: null }),
        sel: -1, playing: false, orb: false });
      const transaction = beginOverlayTransform(target);
      if (!transaction) return;
      current = {
        target, transaction, points: new Map(), anchor: { x: event.clientX, y: event.clientY, distance: 1 },
        original: transaction.value(), movable: !!direct, pinched: false, moved: false,
        part: target.kind === "component" ? (event.target as Element).closest<HTMLElement>("[data-look-part]")?.dataset.lookPart as LookPart ?? null : null,
      };
      session.current = current;
    }
    if (current.points.size >= 2) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    current.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (current.points.size === 2) { current.pinched = true; current.movable = true; }
    rebase(current);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = session.current;
    if (!current?.points.has(event.pointerId)) return;
    event.preventDefault();
    current.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!current.movable) return;
    const geometry = gestureGeometry([...current.points.values()]);
    const dx = geometry.x - current.anchor.x, dy = geometry.y - current.anchor.y;
    const ratio = current.points.size === 2 ? geometry.distance / current.anchor.distance : 1;
    if (!current.moved && Math.hypot(dx, dy) < 3 && Math.abs(ratio - 1) < .02) return;
    current.moved = true;
    const box = event.currentTarget;
    if (!box.clientWidth || !box.clientHeight) { cancel(); return; }
    if (!current.transaction.update({
      x: current.original.x + dx / box.clientWidth * 100,
      y: current.original.y + dy / box.clientHeight * 100,
      size: current.original.size * ratio,
    })) cancel();
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = session.current;
    if (!current?.points.has(event.pointerId)) return;
    current.points.delete(event.pointerId);
    release([event.pointerId]);
    if (current.points.size) { rebase(current); return; }
    session.current = null;
    current.transaction.commit();
    if (current.movable && !current.moved && !current.pinched) {
      if (current.target.kind === "component" && current.part) selectComponentLookPart(current.target.id, current.part);
      useCapture.getState().patch({ sheet: current.target.kind === "text" ? "text" : "component" });
    }
  };

  return {
    onPointerDownCapture, onPointerMove, onPointerUp,
    onPointerCancel: cancel,
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (session.current?.points.has(event.pointerId)) cancel();
    },
  };
}
