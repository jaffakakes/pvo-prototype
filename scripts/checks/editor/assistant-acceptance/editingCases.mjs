import assert from "node:assert/strict";
import { close, layer, sameFootage, scene, unchangedScene } from "./assertions.mjs";
import { verifyRealQuizPlayback } from "./quizPlayback.mjs";

const edit = (prompt, verify) => ({ prompt, expect: "edit", maxObservations: 0, verify });
const verifySecondClipExtraction = step => {
  const main = scene(step.after), before = scene(step.before);
  assert.equal(main.audioClips.length, before.audioClips.length + 1);
  assert.deepEqual(layer(main.audioClips, 301), layer(before.audioClips, 301));
  const extracted = main.audioClips.find(item => item.id !== 301);
  assert(extracted); close(extracted.start, 3, "new audio start"); close(extracted.gain, 0.6, "new audio volume");
  close(extracted.in, 1, "new audio source in"); close(extracted.out, 5, "new audio source out");
  assert.equal(layer(main.clips, 12).audioDetached, true);
  for (const clip of before.clips) {
    const actual = layer(main.clips, clip.id);
    assert.deepEqual(actual, clip.id === 12 ? { ...clip, audioDetached: true } : clip);
  }
  assert.deepEqual(main.texts, before.texts); assert.deepEqual(main.components, before.components);
  unchangedScene(step);
};
export const editingCases = [
  {
    id: "multi-edit", title: "Route a compound title, ratio, scene name and gain request",
    steps: [edit('Rename Main to Opening, set the project to square 1:1, add the exact native text "Launch day" from 2 to 4 seconds, and set Opening music volume to 25% and footage volume to 40%. Keep every existing layer and all footage.', step => {
      const main = scene(step.after);
      assert.equal(main.name, "Opening");
      assert.equal(step.after.ratio, "1:1");
      close(main.musicGain, 0.25, "music gain");
      close(main.clipGain, 0.4, "footage gain");
      const text = main.texts.find(item => item.text === "Launch day");
      assert(text); close(text.start, 2, "title start"); close(text.end, 4, "title end");
      assert.equal(main.texts.length, 4);
      assert.deepEqual(main.components, scene(step.before).components);
      sameFootage(step); unchangedScene(step);
    })],
  },
  {
    id: "text-geometry", title: "Update the existing title's exact content, timing and position",
    steps: [edit('Change the existing Intro text to "Ready?", show it from exactly 1 to 3 seconds, and put its center at x=25%, y=30%. Do not add a new text layer or change other layers.', step => {
      const main = scene(step.after), text = layer(main.texts, 201);
      assert.equal(text.text, "Ready?");
      for (const [key, expected] of Object.entries({ start: 1, end: 3, x: 25, y: 30 })) close(text[key], expected, key);
      assert.equal(main.texts.length, 3);
      assert.deepEqual(main.texts.filter(item => item.id !== 201), scene(step.before).texts.filter(item => item.id !== 201));
      assert.deepEqual(main.components, scene(step.before).components);
      sameFootage(step); unchangedScene(step);
    })],
  },
  {
    id: "clip-adjustments", title: "Combine source trim, playback speed and visual adjustments",
    steps: [edit('For the first footage clip in Main only: use source seconds 1 through 5, play it at 2x, mirror it, use cover fit, and set zoom to 1.2. Leave all other footage and authored overlays unchanged.', step => {
      const main = scene(step.after), clip = layer(main.clips, 11);
      for (const [key, expected] of Object.entries({ in: 1, out: 5, speed: 2, zoom: 1.2 })) close(clip[key], expected, key);
      assert.equal(clip.mirror, true); assert.equal(clip.fit, "cover");
      assert.deepEqual(main.clips.slice(1), scene(step.before).clips.slice(1));
      assert.deepEqual(main.texts, scene(step.before).texts);
      assert.deepEqual(main.components, scene(step.before).components);
      unchangedScene(step);
    })],
  },
  {
    id: "split-reorder", title: "Split a clip, find its generated identity and reorder the new half",
    steps: [edit('Split the first Main footage clip at scene time 2 seconds. Move the newly created second half immediately after the original second clip. Preserve every source frame, speed and other layer.', step => {
      const clips = scene(step.after).clips;
      assert.equal(clips.length, 4);
      assert.deepEqual(clips.map(item => item.id).filter(id => id < 10000), [11, 12, 13]);
      assert.deepEqual(clips.map(item => [item.in, item.out, item.speed]), [[0, 2, 1], [1, 5, 1], [2, 6, 1], [2, 6, 2]]);
      assert(clips[2].id >= 10000, "Second half must have the actual generated identity");
      assert.deepEqual(scene(step.after).texts, scene(step.before).texts);
      assert.deepEqual(scene(step.after).components, scene(step.before).components);
      unchangedScene(step);
    })],
  },
  {
    id: "duplicate-delete", title: "Duplicate the requested footage and remove only the requested original",
    steps: [edit('Duplicate the second clip in Main once, then delete the original third clip (the 2x clip). Keep the first clip and both copies of the second clip in order; leave all overlays unchanged.', step => {
      const main = scene(step.after), clips = main.clips;
      assert.equal(clips.length, 3);
      assert.equal(clips[0].id, 11); assert.equal(clips[1].id, 12); assert.notEqual(clips[2].id, 12);
      assert(!clips.some(item => item.id === 13));
      const { id: originalId, ...original } = scene(step.before).clips[1];
      const { id: copyId, ...copy } = clips[2];
      assert.deepEqual(copy, original);
      assert.deepEqual(main.texts, scene(step.before).texts);
      assert.deepEqual(main.components, scene(step.before).components);
      unchangedScene(step);
    })],
  },
  {
    id: "extract-audio", title: "Extract real clip audio, then modify the newly generated audio layer",
    steps: [edit('Detach audio from the first Main footage clip into its own audio layer. Move that extracted audio to start at 1 second and set its volume to 35%. Keep its complete source range and keep the existing Narration audio unchanged.', step => {
      const main = scene(step.after);
      assert.equal(main.audioClips.length, 2);
      const extracted = main.audioClips.find(item => item.id !== 301);
      assert(extracted); close(extracted.start, 1, "extracted audio start"); close(extracted.gain, 0.35, "extracted gain");
      close(extracted.in, 0, "source in"); close(extracted.out, 6, "source out");
      assert.equal(main.clips[0].audioDetached, true);
      assert.deepEqual(layer(main.audioClips, 301), layer(scene(step.before).audioClips, 301));
      assert.deepEqual(main.clips.slice(1), scene(step.before).clips.slice(1));
      unchangedScene(step);
    })],
  },
  {
    id: "audio-split", title: "Split an existing audio layer at scene time and change one half",
    steps: [edit('Split Narration at scene time 8 seconds. Mute only the second half and set the first half volume to 50%. Preserve both halves at their original positions and all footage.', step => {
      const audio = scene(step.after).audioClips;
      assert.equal(audio.length, 2);
      const first = layer(audio, 301), second = audio.find(item => item.id !== 301);
      assert(second);
      assert.deepEqual([first.start, first.in, first.out, first.muted, first.gain], [6, 0, 2, false, 0.5]);
      assert.deepEqual([second.start, second.in, second.out, second.muted], [8, 2, 4, true]);
      sameFootage(step); unchangedScene(step);
    })],
  },
  {
    id: "quiz-reveal", title: "Remove the spoiler, retime the quiz, pause for an answer and reveal later",
    verifyBrowser: verifyRealQuizPlayback,
    steps: [edit('Remove the Spoiler text. Change the existing quiz question to "Which ticket wins?" with answers "Gold" and "Silver". Show the quiz from 1.5 to 2 seconds and pause at 2 seconds until an answer; if someone answers early, wait until the quiz ends before continuing. Add native text "Gold wins" from 10 to 12 seconds. Keep the full original footage and other layers.', step => {
      const main = scene(step.after), quiz = layer(main.components, "quiz-main");
      assert.equal(main.components.length, 2);
      close(quiz.at, 1.5, "quiz start"); close(quiz.dur, 0.5, "quiz duration");
      assert.deepEqual(quiz.responsePolicy, { dispatch: "layer_end", unanswered: "pause" });
      assert.equal(step.components[quiz.id].fields.prompt, "Which ticket wins?");
      assert.deepEqual(step.components[quiz.id].fields.options.map(item => item.label), ["Gold", "Silver"]);
      assert(!main.texts.some(item => item.id === 202));
      const reveal = main.texts.find(item => item.text === "Gold wins");
      assert(reveal); close(reveal.start, 10, "reveal start"); close(reveal.end, 12, "reveal end");
      assert.equal(main.texts.length, 3);
      assert.deepEqual(layer(main.components, "note-main"), layer(scene(step.before).components, "note-main"));
      sameFootage(step); unchangedScene(step);
    })],
  },
  {
    id: "new-component", title: "Create and fill a new component using its generated identifier",
    steps: [edit('Add one new Message card in Main from 7 to 9 seconds, titled "Keep going", body "The ending is close.", and one button labeled "Continue" that continues playback. Keep all existing components.', step => {
      const main = scene(step.after);
      assert.equal(main.components.length, 3);
      const card = main.components.find(item => item.type === "card");
      assert(card); close(card.at, 7, "card start"); close(card.dur, 2, "card duration");
      const fields = step.components[card.id].fields;
      assert.equal(fields.title, "Keep going"); assert.equal(fields.body, "The ending is close.");
      assert.deepEqual(fields.buttons.map(item => item.label), ["Continue"]);
      for (const existing of scene(step.before).components) assert.deepEqual(layer(main.components, existing.id), existing);
      sameFootage(step); unchangedScene(step);
    })],
  },
  {
    id: "new-scene", title: "Create a child scene and place text using its generated identifier",
    steps: [edit('Create a child scene of Main called "Credits" and add only the native title "Made by us" from 0 to 3 seconds in that new scene. Keep Main, Ending and the current scene selection unchanged.', step => {
      assert.equal(step.after.scenes.length, 3);
      const created = step.after.scenes.find(item => item.name === "Credits");
      assert(created); assert.equal(created.parent, "main");
      assert.equal(created.texts.length, 1);
      assert.equal(created.texts[0].text, "Made by us");
      close(created.texts[0].start, 0, "credits start"); close(created.texts[0].end, 3, "credits end");
      assert.equal(step.after.currentSceneId, step.before.currentSceneId);
      unchangedScene(step, "main"); unchangedScene(step);
    })],
  },
  {
    id: "scene-routing", title: "Route one quiz option to an existing scene without changing the other",
    advanced: true,
    steps: [edit('For the existing Main quiz, route the Go option to the existing Ending scene. The Stay option should continue this scene. Keep both labels, question, visual design and timing unchanged.', step => {
      const model = step.components["quiz-main"].model;
      const rules = model.rules;
      assert(rules.some(rule => rule.target === model.structure.options[0].id && rule.action.kind === "scene" && rule.action.sceneId === "ending"), JSON.stringify(rules));
      assert(rules.some(rule => rule.target === model.structure.options[1].id && rule.action.kind === "continue"), JSON.stringify(rules));
      const fields = step.components["quiz-main"].fields;
      assert.equal(fields.prompt, "What happens next?");
      assert.deepEqual(fields.options.map(item => item.label), ["Go", "Stay"]);
      const before = layer(scene(step.before).components, "quiz-main"), after = layer(scene(step.after).components, "quiz-main");
      for (const key of ["at", "dur", "x", "y", "scale"]) assert.equal(after[key], before[key]);
      sameFootage(step); unchangedScene(step);
    })],
  },
  {
    id: "extract-audio-holdout", title: "Preserve existing sound while extracting and adjusting a different footage clip",
    // Kept unchanged as evidence: "all of its source audio" can also mean the
    // untrimmed file, so a trim mismatch here alone is not a proven model defect.
    steps: [edit('Keep the existing Narration track exactly as it is. Take the sound out of the second footage clip in Main and make it a separate audio layer; have that new layer begin at 3 seconds with 60% volume. Keep all of its source audio and every video frame.', verifySecondClipExtraction)],
  },
  {
    id: "extract-audio-preservation", title: "Explicitly preserve extracted source trim while changing only timeline start and volume",
    steps: [edit('Keep the existing Narration track exactly as it is. Extract a separate audio layer from the second footage clip in Main. Preserve the extracted layer’s original sourceIn and sourceOut exactly; only change its timeline start to 3 seconds and its gain to 60%. Do not untrim or extend the audio source range. Preserve every video frame and every other layer.', verifySecondClipExtraction)],
  },
];
