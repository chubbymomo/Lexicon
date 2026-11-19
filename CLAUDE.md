# Lexicon

Vocabulary learning app for a small private group. See `README.md` for the product concept.

## Layout

- `web/` — Next.js app serving the web UI and the HTTP API. Details in `web/README.md`.
- `openapi/openapi.json` — the API contract, generated from `web/src/server/contract.ts`.
- `android/` — Android client (built separately against the OpenAPI contract).

## Working in `web/`

- Postgres must be running for tests and the dev server: `service postgresql start`.
- Checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Next.js 16 and Prisma 7 differ from older versions; read `web/AGENTS.md` and the docs it points to before changing framework-level code.
- Every endpoint is declared in `src/server/contract.ts`. When it changes, run `npm run openapi` and commit the regenerated `openapi/openapi.json`; the Android app depends on it.
- The web UI must only use the public API (`src/lib/api.ts`), never direct server access, so both clients stay equivalent.
- `prisma/data/dictionary.json.gz` is the dictionary and core curriculum, built by `scripts/build-dictionary.py`; `npm run db:seed` loads it (also on every start).
- The tutor uses `claude-haiku-5-5` (the user asked for Haiku, not Opus).
- Tests replace the tutor module; nothing in the test suite may call the Claude API.
