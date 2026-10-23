import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { useCapture } from "../../state/captureStore";
import { beginOverlayTransform } from "../../state/editing/overlayTransform";
import {
  beginStageAnimationTransform,
  type StageAnimationTarget,
} from "../../state/animation/stageGesture";
import { selectedPositionKeyAt } from "../../state/animation/selection";
import {
  canAuthorAnimation,
  sameAnimationTarget,
  selectedAuthoringTarget,
} from "../../state/animation/access";
import {
  selectComponentLayer,
  componentLayerTool,
} from "../../state/components/componentLayerCommands";
import { locate } from "../../domain/clips/timing";
import {
  contactGeometry,
  gestureTransform,
  wrapRotation,
  type TransformBounds,
  type TransformGeometry,
} from "./transformGeometry";
import type { GesturePoint } from "./gestureGeometry";
import type { LookPart } from "../../domain/components/look";
import { selectComponentLookPart } from "../../state/components/componentAuthoringStore";

type Transaction = NonNullable<ReturnType<typeof beginStageAnimationTransform>>;
type Session = {
  target: StageAnimationTarget;
  transaction: Transaction;
  points: Map<number, GesturePoint>;
  anchor: TransformGeometry;
  original: ReturnType<Transaction["value"]>;
  bounds: TransformBounds;
  center: GesturePoint;
  limits: readonly [number, number];
  mode: "move" | "scale" | "rotate";
  movable: boolean;
  pinched: boolean;
  moved: boolean;
  part: LookPart | null;
};

function geometry(session: Session): TransformGeometry {
  const points = [...session.points.values()];
  if (session.mode === "move") return contactGeometry(points);
  const point = points[0];
  return {
    ...session.center,
    distance:
      session.mode === "scale"
        ? Math.max(
            1,
            Math.hypot(point.x - session.center.x, point.y - session.center.y),
          )
        : 1,
    angle:
      session.mode === "rotate"
        ? Math.atan2(point.y - session.center.y, point.x - session.center.x)
        : 0,
  };
}

function layerTarget(
  element: Element,
  selectVideo: boolean,
): StageAnimationTarget | null {
  const id = element.closest("[data-crop-guides]")
    ? "video"
    : element.closest<HTMLElement>("[data-layer-id]")?.dataset.layerId;
  if (id?.startsWith("text:")) return { kind: "text", id: Number(id.slice(5)) };
  if (id?.startsWith("component:"))
    return { kind: "component", id: id.slice(10) };
  if (id === "video" && selectVideo) {
    const clip = locate(
      useCapture.getState().t,
      useCapture.getState().clips,
    )?.c;
    if (clip) return { kind: "clip", id: clip.id };
  }
  return null;
}

function beginTransform(target: StageAnimationTarget) {
  const state = useCapture.getState();
  const animated =
    state.sheet === "crop" ||
    state.sheet === "keyframes" ||
    selectedPositionKeyAt(state.currentSceneId, target, state.t);
  return {
    transaction: animated
      ? beginStageAnimationTransform(target, false)
      : target.kind === "clip"
        ? null
        : beginOverlayTransform(target),
    limits: (!animated && target.kind === "text"
      ? [8, 64]
      : [0.5, 2]) as readonly [number, number],
  };
}

/** One canvas owns selection and every contact, even when a second finger lands outside the selected layer. */
export function useCanvasTransform(
  boxRef: RefObject<HTMLDivElement>,
  directSelectionOnly = false,
) {
  const session = useRef<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sceneId = useCapture((state) => state.currentSceneId);
  const trying = useCapture((state) => !!state.tryMode);
  const picking = useCapture((state) => !!state.playheadPick);
  const release = (ids: number[]) => {
    for (const id of ids)
      if (boxRef.current?.hasPointerCapture(id))
        boxRef.current.releasePointerCapture(id);
  };
  const cancel = () => {
    const current = session.current;
    session.current = null;
    if (!current) return;
    current.transaction.cancel();
    release([...current.points.keys()]);
  };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (
        !session.current ||
        ["Shift", "Control", "Alt", "Meta"].includes(event.key)
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      cancel();
    };
    const onOutside = (event: globalThis.PointerEvent) => {
      if (session.current && !boxRef.current?.contains(event.target as Node))
        cancel();
    };
    const onHidden = () => {
      if (document.hidden) cancel();
    };
    const unsubscribe = useCapture.subscribe((state, previous) => {
      if (
        session.current &&
        (state.localId !== previous.localId ||
          state.t !== previous.t ||
          state.sheet !== previous.sheet ||
          !sameAnimationTarget(
            selectedAuthoringTarget(state),
            session.current.target,
          ))
      )
        cancel();
    });
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      cancel();
      unsubscribe();
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [sceneId, trying, picking]);
  const failed = () => {
    cancel();
    setError("Couldn’t transform this layer. Try again.");
  };
  const rebase = (current: Session) => {
    current.anchor = geometry(current);
    current.original = current.transaction.value();
  };
  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (
      trying ||
      picking ||
      event.button !== 0 ||
      (event.target as Element).closest(
        ".tryPill, [data-animation-path-key], [data-player-playback]",
      )
    )
      return;
    let current = session.current;
    if (!current) {
      const state = useCapture.getState();
      if (!canAuthorAnimation(state)) return;
      const transforming =
        state.sheet === "crop" || state.sheet === "keyframes";
      const selected = selectedAuthoringTarget(state);
      const direct = layerTarget(
        event.target as Element,
        directSelectionOnly ||
          transforming ||
          !!(
            selected?.kind === "clip" &&
            selectedPositionKeyAt(state.currentSceneId, selected, state.t)
          ),
      );
      if (!direct && selected?.kind === "component" && !transforming) {
        state.patch({
          selComp: null,
          ...(componentLayerTool(state.sheet) ? { sheet: null } : {}),
        });
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const target =
        direct ?? (directSelectionOnly && !transforming ? null : selected);
      if (!target || target.kind === "audio" || target.kind === "music") return;
      const layerId =
        target.kind === "clip" ? "video" : `${target.kind}:${target.id}`;
      if (
        ![
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            "[data-layer-id]",
          ),
        ].some((element) => element.dataset.layerId === layerId)
      )
        return;
      if (target.kind === "component") selectComponentLayer(target.id);
      state.patch({
        selText: target.kind === "text" ? target.id : null,
        selComp: target.kind === "component" ? target.id : null,
        sel:
          target.kind === "clip"
            ? state.clips.findIndex((clip) => clip.id === target.id)
            : -1,
        selAudio: null,
        selMusic: false,
        orb: false,
        ...(transforming || target.kind !== "component"
          ? { playing: false }
          : {}),
      });
      const { transaction, limits } = beginTransform(target);
      if (!transaction) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.width || !bounds.height) {
        transaction.cancel();
        return;
      }
      setError(null);
      const original = transaction.value();
      current = {
        target,
        transaction,
        limits,
        original,
        bounds,
        points: new Map(),
        anchor: { x: 0, y: 0, distance: 1, angle: 0 },
        center: {
          x: bounds.left + (original.x / 100) * bounds.width,
          y: bounds.top + (original.y / 100) * bounds.height,
        },
        mode: event.altKey
          ? "rotate"
          : (event.target as Element).closest("[data-transform-handle]")
            ? "scale"
            : "move",
        movable: !!direct || transforming,
        pinched: false,
        moved: false,
        part:
          target.kind === "component"
            ? (((event.target as Element).closest<HTMLElement>(
                "[data-look-part]",
              )?.dataset.lookPart as LookPart) ?? null)
            : null,
      };
      session.current = current;
    }
    if (current.points.size >= 2) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    current.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (current.points.size === 2) {
      current.mode = "move";
      current.pinched = true;
      current.movable = true;
    }
    rebase(current);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = session.current;
    if (!current?.points.has(event.pointerId)) return;
    event.preventDefault();
    current.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!current.movable) return;
    const next = gestureTransform(
      current.original,
      current.anchor,
      geometry(current),
      current.bounds,
      current.limits,
    );
    if (
      !current.moved &&
      Math.hypot(
        ((next.x - current.original.x) * current.bounds.width) / 100,
        ((next.y - current.original.y) * current.bounds.height) / 100,
      ) < 3 &&
      Math.abs(next.size / current.original.size - 1) < 0.02 &&
      Math.abs(wrapRotation(next.rotation - current.original.rotation)) < 1
    )
      return;
    current.moved = true;
    useCapture.getState().patch({ playing: false });
    try {
      if (!current.transaction.update(next)) cancel();
    } catch {
      failed();
    }
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = session.current;
    if (!current?.points.has(event.pointerId)) return;
    current.points.delete(event.pointerId);
    release([event.pointerId]);
    if (current.points.size) {
      current.mode = "move";
      rebase(current);
      return;
    }
    session.current = null;
    try {
      current.transaction.commit();
    } catch {
      current.transaction.cancel();
      failed();
      return;
    }
    if (current.movable && !current.moved && !current.pinched) {
      if (current.target.kind === "component" && current.part)
        selectComponentLookPart(current.target.id, current.part);
      if (
        current.target.kind === "text" &&
        !["crop", "keyframes"].includes(useCapture.getState().sheet ?? "")
      )
        useCapture.getState().patch({ sheet: "text" });
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "+",
        "=",
        "-",
        "[",
        "]",
      ].includes(event.key)
    )
      return;
    const state = useCapture.getState();
    if (!canAuthorAnimation(state)) return;
    const target = layerTarget(event.target as Element, true);
    if (!target || !sameAnimationTarget(selectedAuthoringTarget(state), target))
      return;
    const { transaction, limits } = beginTransform(target);
    if (!transaction) return;
    event.preventDefault();
    event.stopPropagation();
    const value = { ...transaction.value() };
    const step = event.shiftKey ? 5 : 1;
    if (
      (event.target as Element).hasAttribute("data-transform-handle") ||
      ["+", "=", "-"].includes(event.key)
    ) {
      const direction = ["ArrowRight", "ArrowUp", "+", "="].includes(event.key)
        ? 1
        : -1;
      value.size = Math.max(
        limits[0],
        Math.min(
          limits[1],
          value.size + direction * step * (limits[0] === 8 ? 1 : 0.01),
        ),
      );
    } else if (["[", "]"].includes(event.key))
      value.rotation = wrapRotation(
        value.rotation + (event.key === "]" ? step : -step),
      );
    else {
      value.x +=
        event.key === "ArrowRight"
          ? step
          : event.key === "ArrowLeft"
            ? -step
            : 0;
      value.y +=
        event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    }
    try {
      transaction.update(value);
      transaction.commit();
      setError(null);
    } catch {
      transaction.cancel();
      failed();
    }
  };
  return {
    error,
    handlers: {
      onPointerDownCapture,
      onPointerMove,
      onPointerUp,
      onKeyDown,
      onPointerCancel: cancel,
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
        if (session.current?.points.has(event.pointerId)) cancel();
      },
    },
  };
}
