import { evaluateAnimation } from "../../packages/pvo-animation/index.js";

/** PVO scene audio is mixed; source-clock visual animation remains a live layer. */
export function applyVideoMotion(video, clips = [], time, sceneEnd) {
  const clip = clips.find(item => time >= item.start && (time < item.start + (item.out - item.in) / item.speed
    || (time === sceneEnd && time === item.start + (item.out - item.in) / item.speed)));
  const motion = evaluateAnimation(clip?.animation, clip ? clip.in + (time - clip.start) * clip.speed : 0);
  video.style.opacity = String(motion.opacity);
  video.style.transform = `translate(${motion.x}%, ${motion.y}%) rotate(${motion.rotation}deg) scale(${motion.scaleX}, ${motion.scaleY})`;
}
