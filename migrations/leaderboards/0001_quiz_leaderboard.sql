CREATE TABLE quiz_attempts (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  client_key TEXT NOT NULL,
  display_name TEXT CHECK(display_name IS NULL OR length(display_name) BETWEEN 1 AND 32),
  public_consent INTEGER CHECK(public_consent IS NULL OR public_consent IN (0, 1)),
  score INTEGER NOT NULL DEFAULT 0 CHECK(score BETWEEN 0 AND 15),
  answered_count INTEGER NOT NULL DEFAULT 0 CHECK(answered_count BETWEEN 0 AND 15),
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(id, quiz_id),
  CHECK(quiz_id = 'bible-quiz-v1'),
  CHECK(
    (completed_at IS NULL AND display_name IS NULL AND public_consent IS NULL)
    OR
    (completed_at IS NOT NULL AND answered_count = 15 AND display_name IS NOT NULL AND public_consent IS NOT NULL)
  )
);

CREATE INDEX quiz_attempts_client_rate ON quiz_attempts(client_key, created_at);
CREATE INDEX quiz_attempts_ranking
  ON quiz_attempts(quiz_id, public_consent, completed_at, score DESC, id);

CREATE TABLE quiz_answers (
  attempt_id TEXT NOT NULL,
  quiz_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  answer_id TEXT NOT NULL CHECK(answer_id IN ('a', 'b')),
  correct INTEGER NOT NULL CHECK(correct IN (0, 1)),
  answered_at INTEGER NOT NULL,
  PRIMARY KEY(attempt_id, question_id),
  FOREIGN KEY(attempt_id, quiz_id) REFERENCES quiz_attempts(id, quiz_id) ON DELETE CASCADE,
  CHECK(question_id GLOB 'q[1-9]' OR question_id GLOB 'q1[0-5]')
);

CREATE TRIGGER quiz_answer_updates_attempt
AFTER INSERT ON quiz_answers
BEGIN
  UPDATE quiz_attempts
  SET answered_count = answered_count + 1,
      score = score + NEW.correct
  WHERE id = NEW.attempt_id AND quiz_id = NEW.quiz_id AND completed_at IS NULL;
END;
