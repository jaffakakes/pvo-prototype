import { evaluateAnimation, visualMotionVisible } from "../../packages/pvo-animation/index.js";
import { canvasPixelSize, componentPixelTransform, componentSize, observeComponentSize } from "../../packages/pvo-component-runtime/index.js";

/** Geometry updates never replace an interactive component or its input state. */
export function createComponentMotion(position, component, { frame, manifest, elapsedTime, custom = false }) {
  const capture = component.restyle_capture;
  const presentation = component.presentation || {};
  const initialWidth = frame.clientWidth;
  let natural = null;
  const apply = () => {
    const canvas = canvasPixelSize(manifest.canvas?.width, manifest.canvas?.height);
    const unit = canvas.width / frame.clientWidth;
    const size = natural ? componentPixelTransform(capture, { width: natural.width * unit, height: natural.height * unit })
      : componentSize(capture);
    const resize = natural || custom ? 1 : frame.clientWidth / initialWidth;
    const motion = evaluateAnimation(capture?.animation, elapsedTime() - (capture?.at ?? presentation.start ?? 0));
    const x = Number(capture?.x ?? ((presentation.x ?? 0) + (presentation.width ?? 1) / 2) * 100);
    const y = Number(capture?.y ?? ((presentation.y ?? 0) + (presentation.height ?? 1) / 2) * 100);
    position.style.left = `${x + motion.x}%`;
    position.style.top = `${y + motion.y}%`;
    position.style.opacity = String(motion.opacity);
    position.style.visibility = visualMotionVisible(motion) ? "" : "hidden";
    position.style.transform = `translate(-50%, -50%) rotate(${motion.rotation}deg) scale(${size.width * motion.scaleX * resize}, ${size.height * motion.scaleY * resize})`;
  };
  const disconnect = capture?.width !== undefined || capture?.height !== undefined
    ? observeComponentSize(position, value => { natural = value; apply(); }) : () => {};
  apply();
  return { apply, dispose: disconnect };
}
