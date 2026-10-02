/** Deterministic authored state; the browser supplies the real decoded media URL. */
export function acceptanceFixture(media) {
  const clip = (id, sourceIn, sourceOut, speed = 1) => ({
    id, url: media.url, color: "#426B92", srcDur: media.duration,
    in: sourceIn, out: sourceOut, speed, zoom: 1, mirror: false,
    width: media.width, height: media.height, fit: "contain",
  });
  const text = (id, value, start, end) => ({ id, text: value, start, end, x: 50, y: 20, color: 2 });
  return {
    currentSceneId: "main", ratio: "9:16", allowedDomains: [],
    scenes: [
      {
        id: "main", name: "Main", parent: null, muted: false, sound: 1, musicGain: 1, clipGain: 1,
        clips: [clip(11, 0, 6), clip(12, 1, 5), clip(13, 2, 6, 2)],
        texts: [text(201, "Intro", 0, 2), text(202, "Spoiler", 1, 3), text(203, "End card", 10, 12)],
        components: [],
        audioClips: [{ id: 301, name: "Narration", url: media.url, srcDur: media.duration,
          in: 0, out: 4, start: 6, speed: 1, muted: false, gain: 1 }],
      },
      {
        id: "ending", name: "Ending", parent: "main", muted: false, sound: 0,
        clips: [clip(21, 0, 4)], texts: [], components: [], audioClips: [],
      },
    ],
  };
}

export const fixtureDescription = {
  mainDuration: 12,
  mainClips: [{ id: 11, source: [0, 6], speed: 1 }, { id: 12, source: [1, 5], speed: 1 }, { id: 13, source: [2, 6], speed: 2 }],
  texts: { 201: "Intro", 202: "Spoiler", 203: "End card" },
  components: ["quiz-main", "note-main"], audio: [301], scenes: ["main", "ending"],
};
