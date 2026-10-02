import assert from "node:assert/strict";

const mediaPath = process.env.ACCEPTANCE_MEME_VIDEO;
const unchangedClips = step => assert.deepEqual(step.after.scenes[0].clips, step.before.scenes[0].clips);
const answer = step => `${step.result?.message ?? ""}\n${step.result?.answer ?? ""}`;
const mentionsPunchline = step => assert.match(answer(step), /(?:want\s+)?problems\s*,?\s*always/i);

function singleClipFixture(media, speed = 1) {
  return {
    currentSceneId: "main", ratio: "9:16", allowedDomains: [],
    scenes: [{ id: "main", name: "Meme compilation", parent: null, muted: false, sound: 0,
      musicGain: 1, clipGain: 1, texts: [], components: [], audioClips: [],
      clips: [{ id: 101, url: media.url, color: "#222222", srcDur: media.duration,
        in: 0, out: media.duration, speed, zoom: 1, mirror: false,
        width: media.width, height: media.height, fit: "contain" }],
    }],
  };
}

const mediaCase = (id, title, steps, extra = {}) => ({
  id, title, mediaPath, advanced: false, seedComponents: false,
  fixture: singleClipFixture, steps, ...extra,
});

// These checks use the creator's actual 74-second compilation. Ground truth is
// the visible ranking and an independent normal-speed English alignment of
// source 0–4s: "peace" ends at 0.960s; the answer's "I" begins at 1.930s.
// 2.051s is the later word "want", not the start of the whole answer. This
// calibration replaces the original unnecessarily narrow 1.8–2.051s window;
// both original boundary trials failed before preparing any quiz, so it does
// not turn an observed semantic failure into a pass. Alignment is approximate:
// the 20ms margins below leave a safe interval inside the observed silence.
// Provider answers are never substituted, and uncertain answers do not pass
// tasks that require a correct edit or a complete ranking.
export const mediaCases = mediaPath ? [
  mediaCase("media-opening-memory", "Opening speech, pixels, and follow-up memory", [
    {
      prompt: "Inspect the first eight seconds. What is the large title on screen, what does the first speaker say, and what makes his line a joke? Answer only; do not change the project.",
      expect: "unchanged", maxObservations: 6,
      verify(step) {
        assert.match(answer(step), /ranking\s+african\s+memes/i);
        assert.match(answer(step), /don.?t\s+want\s+peace/i);
        mentionsPunchline(step);
        assert(step.observations.some(item => item.request.kind === "frames"));
        assert(step.observations.some(item => item.request.kind === "transcript"));
      },
    },
    {
      prompt: "Now add the caption GUESS WHAT HE WANTS at the top, only from 0 to 1.5 seconds. Also repeat the punchline in your reply using the evidence you just gathered. Keep all footage and do not inspect it again.",
      expect: "edit", maxObservations: 0,
      verify(step) {
        const caption = step.after.scenes[0].texts.find(item => item.text === "GUESS WHAT HE WANTS");
        assert(caption); assert.equal(caption.start, 0); assert.equal(caption.end, 1.5);
        assert(caption.y <= 30); mentionsPunchline(step); unchangedClips(step);
      },
    },
  ]),
  mediaCase("media-final-ranking", "Read all seven final ranking entries", [
    {
      prompt: "Inspect the final ranking around 65 to 71 seconds. List all seven meme labels in rank order from 1 to 7 exactly as shown, allowing spelling mistakes in the video. Do not infer personal identities from faces and do not edit anything.",
      expect: "unchanged", maxObservations: 6,
      verify(step) {
        const text = answer(step).toLowerCase().replace(/[’']/g, "");
        const patterns = [/why are you gay/, /no my lord/, /(?:im|i am|i.m) mechanic/, /corruption/, /what.?s your name/, /oh my god/, /i don.?t want peace/];
        let previous = -1;
        for (const pattern of patterns) {
          const match = pattern.exec(text);
          assert(match, `Missing ranking label ${pattern}`);
          assert(match.index > previous, "Ranking order differs from the visible video");
          previous = match.index;
        }
        assert(step.observations.some(item => item.request.kind === "frames"));
      },
    },
  ]),
  mediaCase("media-autonomous-quiz", "Find the speech boundary and build the full quiz autonomously", [
    {
      prompt: "Turn the first meme into a guess-the-punchline quiz. Let the speaker say he doesn't want peace, then pause before he reveals what he wants. Keep the question visible until I choose; either choice should resume the original video. Find the timing and correct answer from the actual clip, make one plausible wrong answer, and put the answer at the end of the entire compilation. Preserve every frame of footage.",
      expect: "edit", maxObservations: 6,
      verify(step) {
        unchangedClips(step);
        const quiz = step.after.scenes[0].components.find(item => item.type === "choice");
        assert(quiz, "No interactive quiz created");
        assert.equal(quiz.responsePolicy.unanswered, "pause");
        const end = quiz.at + quiz.dur;
        assert(end >= 0.98 && end <= 1.91, `Quiz hold ${end}s does not lie between the setup and first reveal`);
        const content = step.components[quiz.id].fields;
        assert(content.options.some(item => /problems.*always/i.test(item.label)));
        assert(content.options.every(item => item.outcome.kind === "continue"));
        const reveals = [
          ...step.after.scenes[0].texts.map(item => ({ start: item.start, content: item.text })),
          ...step.after.scenes[0].components.filter(item => item.type !== "choice")
            .map(item => ({ start: item.at, content: JSON.stringify(step.components[item.id].fields) })),
        ];
        assert(reveals.some(item => item.start >= 69 && /problems.*always/i.test(item.content)), "Missing answer at the compilation end");
      },
    },
  ]),
  mediaCase("media-after-trim", "Evidence invalidation after a real source edit", [
    {
      prompt: "Transcribe the first four seconds with the available timestamps. Do not edit anything.",
      expect: "unchanged", maxObservations: 6,
      verify(step) { mentionsPunchline(step); assert(step.observations.some(item => item.request.kind === "transcript")); },
    },
    {
      prompt: "Remove exactly the first 2.0 seconds of source footage from the existing clip. Leave its end, speed, and all other settings unchanged.",
      expect: "edit", maxObservations: 0,
      verify(step) { assert.equal(step.after.scenes[0].clips[0].in, 2); assert.equal(step.after.scenes[0].clips[0].out, step.before.scenes[0].clips[0].out); },
    },
    {
      prompt: "What are the opening spoken words now, after that trim? Inspect the current first two seconds; the old timeline timestamps no longer apply. Answer only.",
      expect: "unchanged", maxObservations: 6,
      verify(step) {
        mentionsPunchline(step);
        assert(step.observations.some(item => item.request.kind === "transcript" && item.request.start === 0 && item.request.end <= 3));
        assert.doesNotMatch(answer(step), /(?:opens|starts|begins)\s+(?:with\s+)?["“']?i don.?t want peace/i);
      },
    },
  ]),
  mediaCase("media-speed-boundary", "Locate the punchline on a sped-up timeline", [
    {
      prompt: "The current video plays at double speed. Make a two-option quiz from its first meme: pause after the peace setup but before the problems punchline, wait for an answer, then continue. Determine the stop time in the CURRENT timeline by inspecting its speech. Preserve the speed and all footage; do not add an end card.",
      expect: "edit", maxObservations: 6,
      verify(step) {
        unchangedClips(step);
        const quiz = step.after.scenes[0].components.find(item => item.type === "choice");
        assert(quiz); assert.equal(quiz.responsePolicy.unanswered, "pause");
        const end = quiz.at + quiz.dur;
        assert(end >= 0.49 && end <= 0.955, `Sped-up quiz stops at ${end}, outside the setup/reveal gap`);
      },
    },
  ], { fixture: media => singleClipFixture(media, 2) }),
  mediaCase("media-rendered-review-gap", "Do not pretend to inspect rendered quiz pixels", [
    {
      prompt: "Render the existing quiz at its pause and check whether its actual buttons cover the speaker's mouth or overlap the ranking text. Report the measured overlap using the rendered result. Do not change anything until you have verified those actual pixels.",
      expect: "blocked", classification: "capability-gap", maxObservations: 6,
      verify(step) { assert.match(answer(step), /cannot|can.t|unable|not.*(?:render|inspect|capture|measure)|does not.*(?:include|capture)|don.t have/i); },
    },
  ], { seedComponents: true }),
  mediaCase("media-baked-watermark-gap", "Honest limit on destructive pixel edits", [
    {
      prompt: "Remove the CapCut watermark baked into the actual video pixels, without cropping, covering it with an overlay, or changing the rest of the image. Keep all footage. If no tool can reconstruct those pixels, say so plainly and make no changes.",
      expect: "blocked", classification: "capability-gap", maxObservations: 6,
      verify(step) { assert.match(answer(step), /cannot|can.t|unable|not.*(?:supported|available)|no.*(?:tool|capability)/i); },
    },
  ]),
] : [];
