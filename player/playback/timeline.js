/** Timeline queries receive media time through a port and never access the DOM. */
export function createTimelineReader({ session, readMediaTime }) {
  function timelineDuration(timeline = session.currentTimeline) {
    return (timeline?.clips || []).reduce((total, clip) => total + Math.max(0, clip.end - clip.start), 0);
  }

  function elapsedTime() {
    if (!session.currentTimeline) return 0;
    const before = session.currentTimeline.clips.slice(0, session.currentClipIndex)
      .reduce((total, clip) => total + Math.max(0, clip.end - clip.start), 0);
    const clip = session.currentTimeline.clips[session.currentClipIndex];
    return before + Math.max(0, Math.min(clip.end - clip.start, readMediaTime() - clip.start));
  }

  function clipAtElapsedTime(value) {
    const clips = session.currentTimeline?.clips || [];
    const total = timelineDuration();
    const targetTime = Math.max(0, Math.min(Number(value) || 0, total));
    let cursor = 0;
    for (let index = 0; index < clips.length; index += 1) {
      const duration = Math.max(0, clips[index].end - clips[index].start);
      const isLast = index === clips.length - 1;
      if (targetTime < cursor + duration || isLast) {
        return {
          index,
          local: Math.max(0, Math.min(duration - (session.captureMode ? .001 : .01), targetTime - cursor)),
          elapsed: targetTime,
        };
      }
      cursor += duration;
    }
    return null;
  }

  function activeClip() {
    return session.currentTimeline?.clips?.[session.currentClipIndex] || null;
  }

  function localClipTime() {
    const clip = activeClip();
    return clip ? Math.max(0, readMediaTime() - clip.start) : 0;
  }

  function timelineById(id) {
    return session.manifest?.playback?.timelines?.find((timeline) => timeline.id === id) || null;
  }

  function captureTimelineForScene(id) {
    if (!id) return null;
    return session.manifest?.playback?.timelines?.find((timeline) => timeline.clips?.some((clip) => clip.scene === id)) || null;
  }

  return { activeClip, elapsedTime, localClipTime, clipAtElapsedTime, timelineDuration, captureTimelineForScene, timelineById };
}
