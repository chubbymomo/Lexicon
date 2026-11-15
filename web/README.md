# Lexicon web app and API

One Next.js (TypeScript) app that serves both the web interface and the HTTP API. Postgres through Prisma, FSRS scheduling through `ts-fsrs`, and the Claude API for the tutor.

## Running it

Requires Node 22 and Postgres 16.

```bash
cp .env.example .env        # then edit the values
npm install                 # also generates the database client
npm run db:migrate          # apply migrations and load the curriculum
npm run dev                 # http://localhost:3000
```

Open the app and choose "Create an account". Everyone uses the invite code from `LEXICON_INVITE_CODE`. Any number of people can join unless `LEXICON_MAX_USERS` sets a cap.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `LEXICON_INVITE_CODE` | Shared secret required to create an account. |
| `LEXICON_MAX_USERS` | Optional cap on the number of accounts. Unlimited when unset. |
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
- `src/server/services/` holds the logic: `words` (the shared collection and the curriculum), `study` (five sentences and reviews), `scheduling` (FSRS), `progress` (XP, streaks, leaderboard), `competition` (challenges, achievements, statistics), `tutor` (Claude).
- `src/app/api/v1/` are thin route files that connect an endpoint to a service function.
- `src/app/` and `src/components/` are the web pages. They call the API through `src/lib/api.ts` and use no private server access, so anything the web app can do, another client can do.
- `prisma/schema.prisma` is the data model.
- `prisma/curriculum.json` is the shared curriculum (see below).

## The API contract

`../openapi/openapi.json` is the contract other clients are built against. It is also served at `/api/v1/openapi.json`. After changing `contract.ts`, regenerate it:

```bash
npm run openapi
```

## The curriculum

`prisma/curriculum.json` is an ordered list of words with complete entries. Every player works through it in the same order: the next word is always the first one they have not started, and at most three can be unfinished at once. Words players add themselves sit alongside it in the same collection.

To change it, edit the file (the order of the list is the order of study) and run `npm run db:seed`. Reloading updates entries in place and keeps everyone's progress. Each entry's `morphemes` are `[kind, form, meaning, origin]`; words that share a prefix or root are linked on their study pages.

## Rules the server enforces

- **Curriculum order.** A curriculum word can only be begun when it is the player's next word, and cannot be introduced to someone else.
- **Challenges.** Daily and weekly challenges are measured from real activity and pay their XP once per period. The shared weekly challenge scales with the number of players and pays everyone when it is met.
- **Five sentences.** A word moves from studying to reviewing only when all five sentence slots have been accepted by the tutor. A sentence must be grammatical, use the word correctly, and show its meaning through context.
- **Scheduling.** Reviews are scheduled by FSRS with a 90% retention target and day-scale intervals. A word is "mastered" once its memory stability reaches 21 days.
- **No XP for busywork.** XP comes from accepted sentences, completing a word's study, correct reviews and mastery. A review is rejected unless the card is due, so reviewing early earns nothing.
