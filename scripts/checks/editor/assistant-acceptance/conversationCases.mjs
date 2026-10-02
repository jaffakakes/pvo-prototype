import assert from "node:assert/strict";
import { close, layer, sameFootage, scene, unchangedScene } from "./assertions.mjs";

export const conversationCases = [
  {
    id: "followup-memory", title: "Resolve a follow-up from prior conversation and the latest authored state",
    steps: [
      {
        prompt: 'Change only the Intro title to "Northern lights" and show it from 2 to 4 seconds.',
        expect: "edit", maxObservations: 0,
        verify(step) {
          const title = layer(scene(step.after).texts, 201);
          assert.equal(title.text, "Northern lights"); close(title.start, 2, "start"); close(title.end, 4, "end");
          sameFootage(step); unchangedScene(step);
        },
      },
      {
        prompt: 'For that title we just changed, replace its wording with "Even brighter" and move it exactly one second later, preserving its duration. Keep everything else.',
        expect: "edit", maxObservations: 0,
        verify(step, { steps }) {
          const main = scene(step.after), title = layer(main.texts, 201);
          assert.equal(title.text, "Even brighter"); close(title.start, 3, "start"); close(title.end, 5, "end");
          assert.equal(main.texts.length, 3);
          assert(step.turns[0].request.history.some(item => item.role === "user" && item.content === steps[0].prompt));
          assert(step.turns[0].request.project.scenes[0].texts.some(item => item.id === 201 && item.text === "Northern lights"));
          assert.deepEqual(main.texts.filter(item => item.id !== 201), scene(step.before).texts.filter(item => item.id !== 201));
          sameFootage(step); unchangedScene(step);
        },
      },
      {
        prompt: 'What wording did I ask for before "Even brighter"? Answer only and do not change the project.',
        expect: "unchanged", maxObservations: 0,
        verify(step) { assert.match(`${step.result.message}\n${step.result.answer ?? ""}`, /Northern lights/i); },
      },
    ],
  },
  {
    id: "project-question", title: "Answer from current editor context without unnecessary media inspection",
    steps: [{
      prompt: "How many footage clips are in Main, and what is its total authored duration in seconds? Answer only; change nothing.",
      expect: "unchanged", maxObservations: 0,
      verify(step) {
        const answer = `${step.result.message}\n${step.result.answer ?? ""}`.replace(/[*_`]/g, "");
        assert.match(answer, /(?:\b3\b|three)\s+(?:footage\s+|video\s+)?clips/i);
        assert.match(answer, /\b12(?:\.0+)?\s*(?:seconds|secs|s\b)/i);
      },
    }],
  },
  {
    id: "already-correct", title: "Recognize an already satisfied request without history churn",
    steps: [{
      prompt: "Keep the project at its current 9:16 ratio and keep the existing Intro title exactly as it is. Nothing needs changing; confirm that.",
      expect: "unchanged", maxObservations: 0,
      verify(step) { assert.equal(step.after.ratio, "9:16"); assert.equal(layer(scene(step.after).texts, 201).text, "Intro"); },
    }],
  },
  {
    id: "external-action", title: "Honestly decline an unavailable external sending action",
    classification: "capability-gap",
    steps: [{
      prompt: "Email this finished project to alex@example.com right now. Do not edit the project or merely add an email form; send it from my account.",
      expect: "blocked", maxObservations: 0,
      verify(step) { assert.match(step.result.message, /cannot|can.t|unable|not (?:available|supported)|don.t have|no (?:email|access|tool)/i); },
    }],
  },
  {
    id: "layer-order-gap", title: "Expose missing native layer-order capability without claiming success",
    classification: "capability-gap",
    steps: [{
      prompt: "Move the existing Intro text behind the footage in Main's layer stack. Preserve its text, timing, position and every other layer. Do not hide it, delete it, move it offscreen, or change opacity as a workaround.",
      expect: "blocked", maxObservations: 0,
      verify(step) { assert.match(step.result.message, /layer|stack|order|behind/i); },
    }],
  },
  {
    id: "music-selection-gap", title: "Expose missing music-track selection without changing gain as a substitute",
    classification: "capability-gap",
    steps: [{
      prompt: "Switch Main's built-in background music to a different built-in track. Keep music volume, timing, footage and every other setting unchanged. Do not just alter the gain or mute it.",
      expect: "blocked", maxObservations: 0,
      verify(step) { assert.match(step.result.message, /music|track/i); },
    }],
  },
  {
    id: "component-geometry", title: "Apply exact component dimensions, per-axis scale and follow-up uniform scale",
    steps: [{
      prompt: "Make the existing quiz exactly 600 canvas pixels wide and 300 canvas pixels tall using its authored width and height. Preserve its x/y position, uniform scale, question, options and timing. Do not substitute uniform scale or CSS styling.",
      expect: "edit", maxObservations: 0,
      verify(step) {
        const quiz = layer(scene(step.after).components, "quiz-main");
        close(quiz.width, 600, "authored width"); close(quiz.height, 300, "authored height");
        const before = layer(scene(step.before).components, "quiz-main");
        for (const key of ["x", "y", "at", "dur"]) assert.equal(quiz[key], before[key]);
        close(quiz.scale ?? 1, before.scale ?? 1, "uniform scale");
        assert.deepEqual(quiz.fields, before.fields);
        sameFootage(step); unchangedScene(step);
      },
    }, {
      prompt: "For that quiz, set its independent horizontal scale to 1.5 and vertical scale to 0.75. Keep the authored 600 by 300 size, position, timing and content unchanged.",
      expect: "edit", maxObservations: 0,
      verify(step) {
        const quiz = layer(scene(step.after).components, "quiz-main");
        close(quiz.scaleX, 1.5, "horizontal scale"); close(quiz.scaleY, 0.75, "vertical scale");
        close(quiz.width, 600, "authored width"); close(quiz.height, 300, "authored height");
        sameFootage(step); unchangedScene(step);
      },
    }, {
      prompt: "Now enlarge that quiz proportionally to a proportional scale of 1.5, preserving its current 2:1 horizontal-to-vertical scale ratio. Leave its authored width and height at 600 by 300.",
      expect: "edit", maxObservations: 0,
      verify(step) {
        const quiz = layer(scene(step.after).components, "quiz-main");
        close(quiz.scaleX / quiz.scaleY, 2, "axis ratio");
        close(quiz.scale, 1.5, "proportional scale for authored pixel dimensions");
        close(quiz.scaleX, 2.25, "proportionally enlarged horizontal scale");
        close(quiz.scaleY, 1.125, "proportionally enlarged vertical scale");
        close(quiz.width, 600, "authored width"); close(quiz.height, 300, "authored height");
        sameFootage(step); unchangedScene(step);
      },
    }],
  },
  {
    id: "until-clip-end", title: "Set component timing to the native Until clip ends contract",
    steps: [{
      prompt: "Set the existing Remember the ticket note to appear at scene time 7 seconds and last until that footage clip ends using the native Until clip ends duration setting. Preserve its text, position, appearance and the footage.",
      expect: "edit", maxObservations: 0,
      verify(step) {
        const note = layer(scene(step.after).components, "note-main");
        close(note.at, 7, "note start"); assert.equal(note.dur, null);
        assert.equal(step.components[note.id].fields.text, "Remember the ticket");
        sameFootage(step); unchangedScene(step);
      },
    }],
  },
  {
    id: "relative-followup-holdout", title: "Apply a relative move once when the follow-up moves an earlier title backward",
    steps: [{
      prompt: 'Change the existing Spoiler title to "A clue" and put it at 3–5 seconds. Keep the other titles and footage.',
      expect: "edit", maxObservations: 0,
      verify(step) {
        const clue = layer(scene(step.after).texts, 202);
        assert.equal(clue.text, "A clue"); close(clue.start, 3, "clue start"); close(clue.end, 5, "clue end");
        sameFootage(step); unchangedScene(step);
      },
    }, {
      prompt: 'Move that clue exactly one and a half seconds earlier and change its words to "Guess now". Its display duration should stay the same; nothing else should move.',
      expect: "edit", maxObservations: 0,
      verify(step) {
        const main = scene(step.after), clue = layer(main.texts, 202);
        assert.equal(clue.text, "Guess now"); close(clue.start, 1.5, "relative start"); close(clue.end, 3.5, "relative end");
        assert.deepEqual(main.texts.filter(item => item.id !== 202), scene(step.before).texts.filter(item => item.id !== 202));
        assert.deepEqual(main.components, scene(step.before).components);
        sameFootage(step); unchangedScene(step);
      },
    }],
  },
  {
    id: "proportional-scale-holdout", title: "Scale an anisotropic note proportionally with no authored pixel dimensions",
    steps: [{
      prompt: "Stretch the existing Remember the ticket note with horizontal scale 1.6 and vertical scale 0.4. Keep its text, position and timing. Leave authored pixel width and height unset.",
      expect: "edit", maxObservations: 0,
      verify(step) {
        const note = layer(scene(step.after).components, "note-main");
        close(note.scaleX, 1.6, "horizontal scale"); close(note.scaleY, 0.4, "vertical scale");
        assert.equal(note.width, undefined); assert.equal(note.height, undefined);
        sameFootage(step); unchangedScene(step);
      },
    }, {
      prompt: "Enlarge that same note proportionally to proportional scale 1.2 while keeping the current 4:1 ratio between its horizontal and vertical scales. Preserve everything else.",
      expect: "edit", maxObservations: 0,
      verify(step) {
        const main = scene(step.after), note = layer(main.components, "note-main");
        close(note.scaleX, 2.4, "enlarged horizontal scale"); close(note.scaleY, 0.6, "enlarged vertical scale");
        close(Math.sqrt(note.scaleX * note.scaleY), 1.2, "proportional scale");
        assert.equal(note.width, undefined); assert.equal(note.height, undefined);
        const before = layer(scene(step.before).components, "note-main");
        for (const key of ["at", "dur", "x", "y"]) assert.equal(note[key], before[key]);
        assert.deepEqual(note.fields, before.fields);
        assert.deepEqual(layer(main.components, "quiz-main"), layer(scene(step.before).components, "quiz-main"));
        sameFootage(step); unchangedScene(step);
      },
    }],
  },
  {
    id: "layer-order-holdout", title: "Do not fabricate existing layer order when a stacking operation is unavailable",
    classification: "capability-gap",
    steps: [{
      prompt: "Put the video layer above every native text layer in Main, by changing the stacking order only. Do not alter any text, coordinates, timing, opacity, source video or component. If your tools cannot reorder the stack, explain that instead of assuming it is already arranged that way.",
      expect: "blocked", maxObservations: 0,
      verify(step) {
        assert.match(step.result.message, /cannot|can.t|unable|not (?:available|supported)|don.t have|no.*tool|tools do not include|no operation/i);
        assert.match(step.result.message, /layer|stack|order/i);
      },
    }],
  },
];
