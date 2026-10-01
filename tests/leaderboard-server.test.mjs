import test from "node:test";
import assert from "node:assert/strict";
import {
  answer,
  CORRECT_ANSWERS,
  createCompletedAttempt,
  finishQuestions,
  leaderboardFixture,
  startAttempt,
  submitCompletion,
} from "./leaderboard-server.helpers.mjs";

test("the first answer starts anonymously and completion publishes the server-owned score", async () => {
  const fixture = await leaderboardFixture();
  try {
    const started = await startAttempt(fixture);
    assert.equal(started.response.status, 201);
    assert.deepEqual({
      displayName: started.body.displayName,
      publicConsent: started.body.publicConsent,
      score: started.body.score,
      answered: started.body.answered,
      complete: started.body.complete,
      correct: started.body.correct,
      text: started.body.text,
    }, {
      displayName: null,
      publicConsent: null,
      score: 1,
      answered: 1,
      complete: false,
      correct: true,
      text: "Score: 1/15",
    });
    assert.equal(started.body.started, true);
    assert.match(started.body.attemptId, /^[A-Za-z0-9_-]{22}$/);
    assert.match(started.body.attemptToken, /^[A-Za-z0-9_-]{43}$/);
    const stored = await fixture.db.prepare(`SELECT token_hash, display_name, public_consent, completed_at
      FROM quiz_attempts WHERE id = ?`).bind(started.body.attemptId).first();
    assert.notEqual(stored.token_hash, started.body.attemptToken);
    assert.equal(stored.display_name, null);
    assert.equal(stored.public_consent, null);
    assert.equal(stored.completed_at, null);

    const wrongStart = await startAttempt(fixture, "b", { address: "192.0.2.9" });
    assert.deepEqual({
      correct: wrongStart.body.correct,
      score: wrongStart.body.score,
      answered: wrongStart.body.answered,
      text: wrongStart.body.text,
    }, { correct: false, score: 0, answered: 1, text: "Score: 0/15" });

    const repeated = await answer(fixture, started.body, 1, CORRECT_ANSWERS[0]);
    assert.deepEqual({
      accepted: repeated.body.accepted,
      answerId: repeated.body.answerId,
      correct: repeated.body.correct,
      score: repeated.body.score,
      answered: repeated.body.answered,
    }, { accepted: false, answerId: "a", correct: true, score: 1, answered: 1 });
    assert.equal((await answer(fixture, started.body, 1, "b")).response.status, 409);

    const answered = await finishQuestions(fixture, started.body);
    assert.deepEqual({
      score: answered.body.score,
      answered: answered.body.answered,
      complete: answered.body.complete,
      total: answered.body.total,
      text: answered.body.text,
    }, { score: 15, answered: 15, complete: false, total: 15, text: "Score: 15/15" });
    assert.equal((await fixture.request("/api/quizzes/bible-quiz-v1/leaderboard")
      .then(value => value.json())).entries.length, 0);

    const completed = await submitCompletion(fixture, started.body, "  Alice   Smith  ");
    assert.equal(completed.response.status, 200);
    assert.deepEqual({
      accepted: completed.body.accepted,
      displayName: completed.body.displayName,
      publicConsent: completed.body.publicConsent,
      score: completed.body.score,
      answered: completed.body.answered,
      complete: completed.body.complete,
    }, {
      accepted: true,
      displayName: "Alice Smith",
      publicConsent: true,
      score: 15,
      answered: 15,
      complete: true,
    });
    assert.deepEqual(completed.body.entries.map(entry => [entry.rank, entry.displayName, entry.score]), [
      [1, "Alice Smith", 15],
    ]);
    assert.equal(completed.body.text, "Leaderboard\n1. Alice Smith — 15/15");

    const retried = await submitCompletion(fixture, started.body, "Alice Smith");
    assert.equal(retried.response.status, 200);
    assert.equal(retried.body.accepted, false);
    assert.equal((await submitCompletion(fixture, started.body, "Different name")).response.status, 409);
  } finally {
    await fixture.close();
  }
});

test("completion returns only the top five finalized attempts with public consent", async () => {
  const fixture = await leaderboardFixture();
  try {
    await createCompletedAttempt(fixture, "Private player", false);
    await startAttempt(fixture);

    const names = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"];
    let latest;
    for (const [index, name] of names.entries()) {
      const answers = [...CORRECT_ANSWERS];
      for (let wrong = 0; wrong < index; wrong += 1)
        answers[14 - wrong] = answers[14 - wrong] === "a" ? "b" : "a";
      latest = await createCompletedAttempt(fixture, name, true, answers);
    }

    assert.equal(latest.response.status, 200);
    assert.deepEqual(latest.body.entries.map(entry => [entry.rank, entry.displayName, entry.score]), [
      [1, "First", 15],
      [2, "Second", 14],
      [3, "Third", 13],
      [4, "Fourth", 12],
      [5, "Fifth", 11],
    ]);
    assert.equal(latest.body.text,
      "Leaderboard\n1. First — 15/15\n2. Second — 14/15\n3. Third — 13/15\n4. Fourth — 12/15\n5. Fifth — 11/15");
    assert(!latest.body.text.includes("Private player"));
    assert(!latest.body.text.includes("Sixth"));
  } finally {
    await fixture.close();
  }
});

test("attempt, answer, and completion boundaries reject forged or malformed writes", async () => {
  const fixture = await leaderboardFixture();
  try {
    assert.equal((await answer(fixture, null, 2, "b")).response.status, 400);
    assert.equal((await fixture.request("/api/quizzes/bible-quiz-v1/answers", {
      method: "POST",
      body: JSON.stringify({ attemptId: "a".repeat(22), questionId: "q1", answerId: "a" }),
      headers: { "Content-Type": "application/json" },
    })).status, 400);
    assert.equal((await fixture.request("/api/quizzes/bible-quiz-v1/answers", {
      method: "POST", body: "{}", headers: { "Content-Type": "text/plain" },
    })).status, 415);

    const attempt = (await startAttempt(fixture)).body;
    assert.equal((await answer(fixture, { ...attempt, attemptToken: "x".repeat(43) }, 2, "b")).response.status, 404);
    assert.equal((await answer(fixture, attempt, 16, "a")).response.status, 400);
    assert.equal((await answer(fixture, attempt, 2, "c")).response.status, 400);
    assert.equal((await submitCompletion(fixture, attempt, "Early player")).response.status, 409);

    await finishQuestions(fixture, attempt);
    for (const input of [
      { displayName: "", publicConsent: true },
      { displayName: "a".repeat(33), publicConsent: true },
      { displayName: "line\nbreak", publicConsent: true },
      { displayName: "\u200b", publicConsent: true },
      { displayName: "Alice", publicConsent: "yes" },
    ]) {
      const response = await fixture.request("/api/quizzes/bible-quiz-v1/complete", {
        method: "POST",
        body: JSON.stringify({
          attemptId: attempt.attemptId,
          attemptToken: attempt.attemptToken,
          ...input,
        }),
        headers: { "Content-Type": "application/json" },
      });
      assert.equal(response.status, 400);
    }

    assert.equal((await fixture.request("/api/quizzes/unknown/leaderboard")).status, 404);
    assert.equal((await fixture.request("/api/quizzes/bible-quiz-v1/attempts", { method: "POST" })).status, 404);
    assert.equal((await fixture.request("/api/quizzes/bible-quiz-v1/leaderboard?limit=51")).status, 400);
    assert.equal((await fixture.request("/api/quizzes/bible-quiz-v1/answers", { method: "GET" })).status, 405);
  } finally {
    await fixture.close();
  }
});

test("cross-origin requests work and anonymous attempt creation is bounded per connection", async () => {
  const fixture = await leaderboardFixture();
  try {
    for (const resource of ["answers", "complete"]) {
      const preflight = await fixture.request(`/api/quizzes/bible-quiz-v1/${resource}`, {
        method: "OPTIONS",
        headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
      assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
    }

    for (let index = 0; index < 30; index += 1)
      assert.equal((await startAttempt(fixture)).response.status, 201);
    assert.equal((await startAttempt(fixture)).response.status, 429);
    assert.equal((await startAttempt(fixture, "a", { address: "192.0.2.2" })).response.status, 201);

    const crossOrigin = await startAttempt(fixture, "a", {
      address: "192.0.2.3",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
    });
    assert.equal(crossOrigin.response.status, 201);
    assert.equal(crossOrigin.response.headers.get("Access-Control-Allow-Origin"), "*");
  } finally {
    await fixture.close();
  }
});
