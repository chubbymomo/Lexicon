# Lexicon for Android

The Android app lives in this folder. It is a client of the same HTTP API the web app uses; it holds no scheduling, scoring or AI logic of its own.

## What to build against

- **The contract:** [`../openapi/openapi.json`](../openapi/openapi.json) (OpenAPI 3.1). Generate the API client and models from it rather than writing them by hand. A running server also serves it at `/api/v1/openapi.json`.
- **Base URL:** `<server>/api/v1`.
- **Sign-in:** `POST /auth/login` (or `/auth/register` with the shared invite code) returns a `token`. Send it as `Authorization: Bearer <token>` on every other request, and store it in encrypted storage. Pass `"client": "android"` when signing in so the session is labelled. `POST /auth/logout` revokes it.
- **Errors:** every error response is `{ "error": { "code", "message" } }`. Show `message` to the user; branch on `code`. A `401` means the token is missing or expired, so return to sign-in.
- **Capabilities:** `GET /meta` needs no token and says whether registration is still open and whether the AI tutor is configured.

## Behaviour to rely on

- The server is the source of truth. After any write, use the response body to update the screen; it carries the new progress, due date and XP.
- `GET /reviews/due` returns cards with a `prompt` and a hidden `answer`. For `DEFINITION_RECALL` and `WORD_FROM_CONTEXT`, reveal the answer and submit the user's self-rating (1 Again, 2 Hard, 3 Good, 4 Easy). For `SENTENCE`, submit the user's sentence instead; the tutor's verdict sets the rating and the response includes written feedback.
- Tutor calls (adding a word without a definition, submitting a sentence) can take several seconds. Show progress, and handle `503 tutor_unavailable` by letting the user retry.
- **Curricula:** `GET /curricula` lists every curriculum with the player's place in it: the `next` word, whether it can be begun (`canStartNext`) and the words in progress. `POST /curricula/{id}/next` begins the next word (it can take a few seconds while the tutor completes the entry) and returns the word; `POST /curricula/{id}/skip` with the `lemma` passes over a word the player already knows. `POST /curricula` makes a new curriculum from a source's text or title and can take up to a minute; show progress. `DELETE /curricula/{id}` removes one the player made.
- **Sentences:** the number needed is `progress.sentencesRequired` (currently 3); don't hard-code it. After the last one is accepted, offer the next word from `GET /curricula`.
- **Stages:** besides STUDYING, REVIEWING and MASTERED, a word can be KNOWN (passed over); it is never reviewed.
- **Players:** there can be any number. `GET /users` lists them; a word's `others` array shows who else has it. Introducing a word needs a `userId`.
- **Competition:** `GET /leaderboard`, `GET /challenges`, `GET /achievements` and `GET /stats` supply everything for the standings and progress screens. The last two accept `?userId=` to look at another player. Dates in `/stats` (`day`, `weekStart`) are plain calendar dates in the server's configured time zone; do not convert them.
- The app needs a connection; there is no offline mode yet.
