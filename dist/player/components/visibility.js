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
      if (!captureAboveVideo(component)) return false;
      if (session.forcedHidden.has(component.id)) return false;
      if (session.forcedVisible.has(component.id)) return true;
      const presentation = component.presentation || {};
      if (session.awaitingComponent?.id === component.id) return true;
      return local >= Number(presentation.start || 0) && local < Number(presentation.end || 0);
    });
  }

  function captureAboveVideo(component) {
    const order = session.captureMode && session.manifest.restyle_capture?.scene_layers?.[adapters.activeClip()?.scene]?.order;
    return !Array.isArray(order) || order.indexOf(`component:${component.id}`) > order.indexOf("video");
  }

  return { visibleComponents, componentsForClip, captureAboveVideo };
}
