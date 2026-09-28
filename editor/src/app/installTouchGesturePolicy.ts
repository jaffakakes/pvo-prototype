/** Cancel browser pinch handling without consuming editor events or single touches. */
export function installTouchGesturePolicy(target: HTMLElement | Document) {
  const preventPageGesture = (event: Event) => {
    if (event.cancelable) event.preventDefault();
  };
  const preventMultiTouchZoom = (event: Event) => {
    // The first finger can still scroll controls, select text, or use a slider.
    const touches = (event as TouchEvent).touches;
    if (touches?.length > 1) preventPageGesture(event);
  };
  const options = { capture: true, passive: false };
  const gestureEvents = ["gesturestart", "gesturechange", "gestureend"];

  // Safari emits separate gesture events; touchstart also covers a second
  // finger arriving after a one-finger interaction has already started.
  for (const type of gestureEvents) target.addEventListener(type, preventPageGesture, options);
  target.addEventListener("touchstart", preventMultiTouchZoom, options);
  target.addEventListener("touchmove", preventMultiTouchZoom, options);

  return () => {
    for (const type of gestureEvents) target.removeEventListener(type, preventPageGesture, options);
    target.removeEventListener("touchstart", preventMultiTouchZoom, options);
    target.removeEventListener("touchmove", preventMultiTouchZoom, options);
  };
}
