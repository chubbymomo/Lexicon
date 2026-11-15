# Lexicon web app and API

One Next.js (TypeScript) app that serves both the web interface and the HTTP API. Postgres through Prisma, FSRS scheduling through `ts-fsrs`, and the Claude API for the tutor.

## Running it

Requires Node 22 and Postgres 16.

```bash
cp .env.example .env        # then edit the values
npm install                 # also generates the database client
npm run db:migrate          # apply migrations to DATABASE_URL
npm run dev                 # http://localhost:3000
```

Open the app and choose "Create one of the two accounts". Both people use the invite code from `LEXICON_INVITE_CODE`; after two accounts exist, registration closes.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `LEXICON_INVITE_CODE` | Shared secret required to create an account. |
| `ANTHROPIC_API_KEY` | Enables the AI tutor. Without it, entries are written by hand and sentences cannot be evaluated. |
| `LEXICON_TIMEZONE` | IANA zone (for example `America/New_York`) used for streak days and the weekly leaderboard. Defaults to UTC. |

## Checks

```bash
npm test             # needs Postgres; uses the lexicon_test database
npm run typecheck
npm run lint
npm run build
```

Tests run the real route handlers against a real database. Only the tutor is replaced, so no test calls the Claude API. Set `TEST_DATABASE_URL` to point them somewhere else.

## How it is organised

- `src/server/contract.ts` declares every endpoint once: path, request and response schemas. Route handlers validate against it, and the OpenAPI document is generated from it.
- `src/server/services/` holds the logic: `words` (the shared collection), `study` (five sentences and reviews), `scheduling` (FSRS), `progress` (XP, streaks, leaderboard), `tutor` (Claude).
- `src/app/api/v1/` are thin route files that connect an endpoint to a service function.
- `src/app/` and `src/components/` are the web pages. They call the API through `src/lib/api.ts` and use no private server access, so anything the web app can do, another client can do.
- `prisma/schema.prisma` is the data model.

## The API contract

`../openapi/openapi.json` is the contract other clients are built against. It is also served at `/api/v1/openapi.json`. After changing `contract.ts`, regenerate it:

```bash
npm run openapi
```

## Rules the server enforces

- **Five sentences.** A word moves from studying to reviewing only when all five sentence slots have been accepted by the tutor. A sentence must be grammatical, use the word correctly, and show its meaning through context.
- **Scheduling.** Reviews are scheduled by FSRS with a 90% retention target and day-scale intervals. A word is "mastered" once its memory stability reaches 21 days.
- **No XP for busywork.** XP comes from accepted sentences, completing a word's study, correct reviews and mastery. A review is rejected unless the card is due, so reviewing early earns nothing.
