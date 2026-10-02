import { useLayoutEffect,useRef,useState } from "react";
import { drawText,layoutText } from "../../../../packages/pvo-text-runtime/index.js";
import type { TextOverlay } from "../../domain/project/model";
import { cx } from "../../styles";

export function TextLayer({ overlay, width, height, zIndex, selected, trying, time }: {
  overlay: TextOverlay; width: number; height: number; zIndex: number; selected: boolean; trying: boolean; time: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<ReturnType<typeof layoutText> | null>(null);
  useLayoutEffect(() => {
    let live = true;
    const paint = () => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx || !live) return;
      ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, width, height);
      setBox(drawText(ctx, width, height, overlay, time - overlay.start));
    };
    paint(); void document.fonts.ready.then(paint);
    return () => { live = false; };
  }, [overlay, width, height, time]);
  return <div className={cx("textLayer")} data-layer-id={`text:${overlay.id}`} style={{ zIndex }}>
    <canvas ref={canvas} width={Math.round(width * 2)} height={Math.round(height * 2)} style={{ width, height }} />
    {box && !trying && <button className={cx("textOverlay")} data-sel={selected} aria-label={`Edit text: ${overlay.text}`} style={{ left: box.x, top: box.y, width: box.width, height: box.height, transform: `rotate(${box.style.rotation}deg) scale(${box.scaleX}, ${box.scaleY})` }} />}
  </div>;
}
