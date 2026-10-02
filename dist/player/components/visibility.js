export function createComponentQueries({ session, adapters }) {
  function componentMatchesClip(component, clip) {
    const presentation = component.presentation || {};
    return presentation.clip
      ? presentation.clip === (clip.source_clip || clip.id)
      : presentation.scene === clip.scene;
  }

  function componentsForClip(clip = adapters.activeClip()) {
    if (!clip) return [];
    return (session.manifest?.components || []).filter((component) => componentMatchesClip(component, clip));
  }

  function visibleComponents() {
    const local = session.captureMode ? adapters.elapsedTime() : adapters.localClipTime();
    return componentsForClip().filter((component) => {
      if (session.forcedHidden.has(component.id)) return false;
      if (session.forcedVisible.has(component.id)) return true;
      const presentation = component.presentation || {};
      if (session.awaitingComponent?.id === component.id) return true;
      return local >= Number(presentation.start || 0) && local < Number(presentation.end || 0);
    });
  }

  function componentCanReceiveResponse(component, time = adapters.elapsedTime()) {
    if (!session.captureMode) return true;
    const capture = component.restyle_capture;
    const presentation = component.presentation || {};
    const motion = evaluateAnimation(capture?.animation, time - (capture?.at ?? presentation.start ?? 0));
    const center = { x: Number(capture?.x ?? 50), y: Number(capture?.y ?? 50) };
    if (!animatedCenterVisible(motion, center)) return false;
    const sceneId = presentation.scene ?? adapters.activeClip()?.scene;
    const layers = session.manifest.restyle_capture?.scene_layers?.[sceneId];
    const order = layers?.order;
    if (!Array.isArray(order) || order.indexOf(`component:${component.id}`) > order.indexOf("video")) return true;
    const active = adapters.activeClip();
    const sceneEnd = active?.end - active?.start;
    const source = layers.clips?.find(item => time >= item.start
      && (time < item.start + (item.out - item.in) / item.speed
        || time === sceneEnd && time === item.start + (item.out - item.in) / item.speed));
    const videoMotion = evaluateAnimation(source?.animation, source ? source.in + (time - source.start) * source.speed : 0);
    return !videoCoversPoint(videoMotion, { x: center.x + motion.x, y: center.y + motion.y },
      session.manifest.canvas?.width / session.manifest.canvas?.height);
  }

  return { visibleComponents, componentsForClip, componentCanReceiveResponse };
}
import { animatedCenterVisible, evaluateAnimation, videoCoversPoint } from "../../packages/pvo-animation/index.js";
