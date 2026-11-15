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
- The app needs a connection; there is no offline mode yet.
