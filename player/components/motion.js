import { evaluateAnimation, visualMotionVisible } from "../../packages/pvo-animation/index.js";
import { canvasPixelSize, componentPixelTransform, componentSize, observeComponentSize } from "../../packages/pvo-component-runtime/index.js";

/** Geometry updates never replace an interactive component or its input state. */
export function createComponentMotion(position, component, { manifest, elapsedTime }) {
  const capture = component.restyle_capture;
  const presentation = component.presentation || {};
  let natural = null;
  const apply = () => {
    const canvas = canvasPixelSize(manifest.canvas?.width, manifest.canvas?.height);
    // Views render at the fixed 247px design width. Fitted-footage scaling and
    // temporary accessibility lifts stay outside authored animation transforms.
    const unit = canvas.width / 247;
    const size = natural ? componentPixelTransform(capture, { width: natural.width * unit, height: natural.height * unit })
      : componentSize(capture);
    const motion = evaluateAnimation(capture?.animation, elapsedTime() - (capture?.at ?? presentation.start ?? 0));
    const x = Number(capture?.x ?? ((presentation.x ?? 0) + (presentation.width ?? 1) / 2) * 100);
    const y = Number(capture?.y ?? ((presentation.y ?? 0) + (presentation.height ?? 1) / 2) * 100);
    position.style.left = `${x + motion.x}%`;
    position.style.top = `${y + motion.y}%`;
    position.style.opacity = String(motion.opacity);
    position.style.visibility = visualMotionVisible(motion) ? "" : "hidden";
    position.style.transform = `translate(-50%, -50%) translate(var(--component-lift-x, 0px), var(--component-lift-y, 0px)) scale(var(--component-lift-scale, 1)) scale(var(--component-unit, 1)) rotate(${motion.rotation}deg) scale(${size.width * motion.scaleX}, ${size.height * motion.scaleY})`;
  };
  const disconnect = capture?.width !== undefined || capture?.height !== undefined
    ? observeComponentSize(position, value => { natural = value; apply(); }) : () => {};
  apply();
  return { apply, dispose: disconnect };
}
