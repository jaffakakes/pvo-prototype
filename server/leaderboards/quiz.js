export const BIBLE_QUIZ_ID = "bible-quiz-v1";
export const BIBLE_QUIZ_QUESTION_COUNT = 15;

const ANSWER_KEY = Object.freeze({
  q1: "a",
  q2: "b",
  q3: "a",
  q4: "a",
  q5: "b",
  q6: "a",
  q7: "a",
  q8: "b",
  q9: "a",
  q10: "b",
  q11: "a",
  q12: "b",
  q13: "a",
  q14: "b",
  q15: "a",
});

export function isBibleQuizQuestion(value) {
  if (typeof value !== "string" || !/^q(?:[1-9]|1[0-5])$/.test(value)) return false;
  return true;
}

export function isBibleQuizAnswer(value) {
  return value === "a" || value === "b";
}

export function bibleQuizAnswerScore(questionId, answerId) {
  return Number(ANSWER_KEY[questionId] === answerId);
}
