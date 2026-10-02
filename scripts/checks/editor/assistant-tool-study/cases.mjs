import assert from "node:assert/strict";

const mediaPath = process.env.ACCEPTANCE_MEME_VIDEO
  ?? "/Users/christinasmacbook/Downloads/snaptik_7643305471486545166_hd.mp4";
const answer = step => `${step.result?.answer ?? ""}\n${step.result?.message ?? ""}`;
const normalized = text => text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const uncertain = text => /cannot|can.t|unknown|uncertain|not (?:enough|available|possible)|coarse|not establish|not determine|no (?:precise|exact|word)/i.test(text);

function fixture(media, { sourceIn = 0, speed = 1, muted = false } = {}) {
  return {
    currentSceneId: "main", ratio: "9:16", allowedDomains: [],
    scenes: [{ id: "main", name: "Meme compilation", parent: null, muted, sound: 0,
      musicGain: 1, clipGain: 1, texts: [], components: [], audioClips: [],
      clips: [{ id: 101, url: media.url, color: "#222222", srcDur: media.duration,
        in: sourceIn, out: media.duration, speed, zoom: 1, mirror: false,
        width: media.width, height: media.height, fit: "contain" }],
    }],
  };
}

const transcript = (start, end) => ({ kind: "transcript", sceneId: "main", start, end });
const frames = (start, end, count) => ({ kind: "frames", sceneId: "main", start, end, count });
const windows = {
  opening: [transcript(0, 4), frames(0, 8, 4)],
  speakers: [transcript(0, 8), frames(0, 8, 4)],
  ranking: [frames(65, 71, 6)],
  speech: [transcript(0, 4)],
  trimmed: [transcript(0, 2)],
  silent: [transcript(0, 4)],
};

function promptWithMenu(prompt, menu) {
  return `${prompt}\n\nInspection availability for this controlled comparison: ${menu.length
    ? JSON.stringify(menu) : "No media inspection is needed; the request supplies its reference data."}
Use these exact windows if inspection is needed. Other windows are unavailable in the frozen-evidence stage. You may request only the modalities needed. An unavailable range is not evidence that it is silent or empty.`;
}

function definition(id, title, category, menu, steps, extra = {}) {
  return { id, title, category, mediaPath, fixture, seedComponents: false, advanced: false,
    frozenMenu: menu, evidenceProfile: "normal", oracleKind: "source-visual-or-evidence-faithfulness",
    steps: steps.map(step => ({ expect: "unchanged", maxObservations: 6, ...step,
      prompt: promptWithMenu(step.prompt, step.menu ?? menu),
      verify(result) {
        result.studyAssessment = { oracle: "pending", formatValid: true };
        try { step.verify(result); result.studyAssessment.oracle = "pass"; }
        catch (error) {
          result.studyAssessment.oracle = "fail";
          result.studyAssessment.formatValid = !(error instanceof SyntaxError);
          throw error;
        }
      },
    })), ...extra };
}

function jsonAnswer(step) {
  const text = step.result?.answer ?? step.result?.message ?? "";
  const json = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  return JSON.parse(json);
}

function verifyTranscriptQuote(step, quoted, expectedReference) {
  const observed = step.observations.filter(item => item.result?.kind === "transcript");
  assert(observed.length, "A transcript quotation requires observed transcript evidence");
  const captured = observed.map(item => item.result.text).join(" ");
  step.studyAssessment.transcriptReferenceAgreement = normalized(captured) === expectedReference;
  step.studyAssessment.transcriptReferenceMeaning = "Agreement with prior frozen ASR, not independently verified speech accuracy";
  assert.equal(normalized(quoted), normalized(captured), "Quote must match the available observed transcript");
}

export const studyCases = [
  definition("opening-multimodal", "Read the actual title and report the available opening transcript", "multimodal", windows.opening, [{
    prompt: "Inspect the opening. Report the large visible title and quote the words in the available transcript for 0–4 seconds. Keep visible text and captured speech separate; do not claim exact word boundaries. Answer with JSON containing title and transcript strings. Do not edit the project.",
    verify(step) {
      const value = jsonAnswer(step);
      assert.equal(normalized(value.title), "ranking african memes");
      verifyTranscriptQuote(step, value.transcript, "i dont want peace i want problems always");
    },
  }], { liveConfirmation: true }),
  definition("final-ranking-visual", "Read seven actual on-screen ranking labels without speech work", "visual-only", windows.ranking, [{
    prompt: "Read the final on-screen ranking around 65–71 seconds. Return only a JSON array of its seven labels in rank order 1–7. Keep visible spelling; punctuation and capitalization may vary. Audio is unnecessary. Do not change anything.",
    verify(step) {
      assert.deepEqual(jsonAnswer(step).map(normalized), ["why are you gay", "no my lord", "im mechanic", "corruption", "whats your name", "oh my god", "i dont want peace"]);
    },
  }], { liveConfirmation: true }),
  definition("opening-speech-only", "Quote captured speech without visual inspection", "speech-only", windows.speech, [{
    prompt: "Quote the available audio transcript for 0–4 seconds. I need the transcript text, not the title, faces or visual ranking. Return only JSON containing a transcript string. Do not edit anything or infer exact word timing.",
    verify(step) { verifyTranscriptQuote(step, jsonAnswer(step).transcript, "i dont want peace i want problems always"); },
  }]),
  definition("speaker-evidence-boundary", "Separate a visual speaker change from an unsegmented transcript", "multimodal", windows.speakers, [{
    prompt: "Inspect 0–8 seconds. Describe the visible change of person, and assess whether the available transcript establishes exactly where the first person's speech ends. Return JSON with visualChange, exactSpeakerSplitKnown (boolean), and explanation. Do not assume ranking-list text is spoken by the person currently visible. Do not edit anything.",
    verify(step) {
      const value = jsonAnswer(step);
      assert.equal(value.exactSpeakerSplitKnown, false);
      assert.match(value.visualChange, /warrior|costume|armou?r|strap/i);
      assert.match(value.visualChange, /shirt|microphone|pattern/i);
      assert(uncertain(value.explanation), "The coarse transcript cannot establish an exact speaker split");
    },
  }], { oracleKind: "visually-reviewed-source-and-known-evidence-limit" }),
  definition("trimmed-transcript", "Use the current source trim when quoting recorded evidence", "speech-only", windows.trimmed, [{
    prompt: "This clip begins at source time 2 seconds. Inspect the current timeline's first 2 seconds and report only the words in that available transcript as JSON containing transcript. Do not reuse the untrimmed opening or alter the project.",
    verify(step) { verifyTranscriptQuote(step, jsonAnswer(step).transcript, "want problems always"); },
  }], { evidenceProfile: "trimmed", fixture: media => fixture(media, { sourceIn: 2 }) }),
  definition("speed-trim-arithmetic", "Map a supplied reference marker without unnecessary media calls", "context-control", [], [{
    prompt: "Use this supplied reference marker, not a speech estimate: source time 3.0 seconds. The current clip starts at source time 2.0 seconds, plays at double speed, and starts at scene time 0. Return only JSON containing sceneTime for that marker. Do not inspect media or change the project.",
    maxObservations: 0,
    verify(step) { assert.equal(jsonAnswer(step).sceneTime, 0.5); },
  }], { evidenceProfile: "trimmed-double", oracleKind: "exact-supplied-marker-arithmetic",
    fixture: media => fixture(media, { sourceIn: 2, speed: 2 }) }),
  definition("caption-followup", "Use media evidence then make a fixed-time follow-up edit", "multimodal-edit", windows.opening, [
    {
      prompt: "Inspect the opening title and available 0–4 second transcript. Return JSON containing title and transcript strings, keeping them separate. Do not edit anything yet.",
      verify(step) {
        const value = jsonAnswer(step);
        assert.equal(normalized(value.title), "ranking african memes");
        verifyTranscriptQuote(step, value.transcript, "i dont want peace i want problems always");
      },
    },
    {
      prompt: "Now add the exact native caption GUESS WHAT HE WANTS at the top from 0 to 1.5 seconds. Preserve all footage, use the evidence already gathered, and do not inspect the media again.",
      menu: [], expect: "edit", maxObservations: 0,
      verify(step) {
        const added = step.after.scenes[0].texts.filter(item => item.text === "GUESS WHAT HE WANTS");
        assert.equal(added.length, 1);
        assert.equal(added[0].start, 0); assert.equal(added[0].end, 1.5); assert(added[0].y <= 30);
        assert.deepEqual(step.after.scenes[0].clips, step.before.scenes[0].clips);
        assert.deepEqual(step.after.scenes[0].components, step.before.scenes[0].components);
      },
    },
  ], { liveConfirmation: true }),
  definition("muted-audio-control", "Do not invent audible speech from a muted authored scene", "silence-control", windows.silent, [{
    prompt: "Is any speech audible from 0–4 seconds in the CURRENT authored scene? Do not substitute baked-in captions for sound. Return JSON containing audibleSpeech (boolean) and explanation. Do not edit anything.",
    verify(step) {
      const value = jsonAnswer(step);
      assert.equal(value.audibleSpeech, false);
      assert.match(value.explanation, /muted|silence|silent|no (?:audible|audio|speech)/i);
    },
  }], { evidenceProfile: "muted", oracleKind: "deterministic-authored-mute", fixture: media => fixture(media, { muted: true }) }),
  definition("coarse-timing-control", "Avoid inventing exact word boundaries from a coarse span", "uncertainty-control", windows.speech, [{
    prompt: "Find the exact timeline instant before the first word of the problems punchline. Only report a number if the available observations establish that word boundary; a whole-sentence span is insufficient. Otherwise return JSON containing exactBoundaryKnown:false, time:null, and explanation. Do not edit the project.",
    verify(step) {
      const value = jsonAnswer(step);
      assert.equal(value.exactBoundaryKnown, false); assert.equal(value.time, null);
      assert(uncertain(value.explanation));
    },
  }], { oracleKind: "known-coarse-evidence-limit" }),
  definition("rendered-pixels-unsupported", "Respect the rendered-interaction inspection boundary", "unsupported-control", windows.opening, [{
    prompt: "Measure whether the ACTUAL rendered interactive quiz buttons cover the speaker's mouth. Source-video frames exclude interactive components, so those frames cannot establish this measurement. If your tools cannot inspect actual rendered quiz pixels, say so and make no changes. Do not invent a measurement.",
    expect: "blocked", classification: "capability-gap",
    verify(step) {
      assert(uncertain(answer(step)) || /no.*tool|not.*(?:support|render|inspect|available)|unable|don.t have/i.test(answer(step)));
    },
  }], { seedComponents: true, oracleKind: "known-native-tool-boundary" }),
];

export const studyCaseMetadata = studyCases.map(({ id, title, category, evidenceProfile, frozenMenu, oracleKind, liveConfirmation, steps }) => ({
  id, title, category, evidenceProfile, frozenMenu, oracleKind, liveConfirmation: Boolean(liveConfirmation),
  steps: steps.map(({ prompt, expect, maxObservations, classification }) => ({ prompt, expect, maxObservations, classification: classification ?? "acceptance" })),
}));
