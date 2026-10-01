# Local quiz leaderboard

This Worker is an external test service for sandboxed PVO requests. It does not change the PVO language, SDK, editor, or player. The checked-in Wrangler configuration is local-only and must not be deployed.

Initialize its local D1 database once, then start it:

```sh
npm run db:leaderboard:local
npm run dev:leaderboard
```

The API binds only to `http://127.0.0.1:8788` and permits cross-origin requests so a PVO player can exercise its existing approved request bridge. Local D1 data stays under ignored `.wrangler/anonymous-quiz-leaderboard/`.

The fixed `bible-quiz-v1` contract exposes:

- `POST /api/quizzes/bible-quiz-v1/answers`
- `POST /api/quizzes/bible-quiz-v1/complete`
- `GET /api/quizzes/bible-quiz-v1/leaderboard`

The first answer (`q1`) omits attempt credentials and creates an anonymous attempt. Its response returns `attemptId` and `attemptToken`; every later answer sends those credentials back. Answer responses include the server-owned `correct`, `score`, and `text` values used by the quiz's bottom-right score Note.

After all 15 answers, `POST /complete` accepts the credentials, display name, and public-consent flag. It finalizes the attempt and returns the current score plus the top five `entries` and leaderboard `text` in one response for the final Note. Once q1 has returned credentials, repeating the same answer or completion is safe; conflicting retries are rejected. If the anonymous q1 response itself is lost, restart the local quiz because the client has no credentials with which to identify that attempt. Only finalized, consented attempts appear publicly, and individual answers are never listed.

An HTTPS-hosted editor cannot call plain HTTP localhost directly. For that local browser experiment, use a temporary HTTPS tunnel to `127.0.0.1:8788`; it forwards to this process and disappears when the process stops. It is not a Worker deployment, but the temporary URL is reachable from the internet while it is active, so use test names only.
