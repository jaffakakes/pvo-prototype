/** Observe layout bounds before CSS transforms, including asynchronous PVO content. */
export function observeComponentSize(element, onSize) {
  const observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const border = entry.borderBoxSize[0];
    const width = border?.inlineSize ?? entry.contentRect.width;
    const height = border?.blockSize ?? entry.contentRect.height;
    if (width > 0 && height > 0) onSize({ width, height });
  });
  observer.observe(element);
  return () => observer.disconnect();
}
