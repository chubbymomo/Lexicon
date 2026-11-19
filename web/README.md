# Lexicon web app and API

One Next.js (TypeScript) app that serves both the web interface and the HTTP API. Postgres through Prisma, FSRS scheduling through `ts-fsrs`, and the Claude API for the tutor.

## Running it

Requires Node 22 and Postgres 16.

```bash
cp .env.example .env        # then edit the values
npm install                 # also generates the database client
npm run db:migrate          # apply migrations, load the dictionary and core curriculum
npm run dev                 # http://localhost:3000
```

Open the app and choose "Create an account". Everyone uses the invite code from `LEXICON_INVITE_CODE`. Any number of people can join unless `LEXICON_MAX_USERS` sets a cap.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `LEXICON_INVITE_CODE` | Shared secret required to create an account. |
| `LEXICON_MAX_USERS` | Optional cap on the number of accounts. Unlimited when unset. |
| `ANTHROPIC_API_KEY` | Enables the AI tutor (Claude Haiku). Without it, dictionary entries are used as they are, words missing from the dictionary need a hand-written definition, curricula need the source's text, and sentences cannot be evaluated. |
| `LEXICON_SECURE_COOKIES` | Leave unset: the session cookie is marked `Secure` when the request arrives over HTTPS. Set `true` or `false` to force it. |
| `LEXICON_TIMEZONE` | IANA zone (for example `America/New_York`) used for streak days and the weekly leaderboard. Defaults to UTC. |

To deploy with Docker instead, see the repository's top-level README.

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
- `src/server/services/` holds the logic: `words` (the shared collection), `dictionary` (lookup, word forms, finding vocabulary in a text), `curricula` (the ordered word lists), `study` (sentences and reviews), `scheduling` (FSRS), `progress` (XP, streaks, leaderboard), `competition` (challenges, achievements, statistics), `tutor` (Claude).
- `src/app/api/v1/` are thin route files that connect an endpoint to a service function.
- `src/app/` and `src/components/` are the web pages. They call the API through `src/lib/api.ts` and use no private server access, so anything the web app can do, another client can do.
- `prisma/schema.prisma` is the data model.
- `prisma/data/dictionary.json.gz` is the dictionary and core curriculum (see below).

## The API contract

`../openapi/openapi.json` is the contract other clients are built against. It is also served at `/api/v1/openapi.json`. After changing `contract.ts`, regenerate it:

```bash
npm run openapi
```

## The dictionary and curricula

`prisma/data/dictionary.json.gz` holds about 47,700 English words from WordNet 3.0 (definition, part of speech, synonyms, antonyms, examples) with how common each is, and the core curriculum: about 14,000 of them chosen for vocabulary study and ordered from more common to rarer. It is built by `scripts/build-dictionary.py`, which documents its choices (no proper nouns, numbers, technical jargon, offensive senses, or easy derivations like "darkness").

A word joins the collection (the `Word` table) only when someone first begins it. At that moment the tutor fills in what WordNet lacks: pronunciation, etymology, prefixes and roots, and further examples. That happens once per word, for everyone. Without the tutor, the dictionary entry is used as it is.

A curriculum is an ordered list. Every player takes it in the same order: their next word is the first they have not begun, at most three can be unfinished per curriculum, and a word they already know can be passed over (it is marked "known" and never reviewed). A word begun anywhere counts everywhere, so nobody is asked for the same word twice.

The **placement check** (`/placement`, or `POST /api/v1/curricula/core/placement`) finds where a player should start in the core curriculum. It splits the list into ten levels, from common to rare (they begin at 0%, 2%, 5%, 9%, 14%, 21%, 30%, 42%, 58% and 78% of the way through), and asks multiple-choice questions: a word and four definitions, or "I don't know". Two right answers pass a level and two wrong ones end the check, so it takes two or three questions per level. The player starts at the beginning of the first level they do not pass. Words before that point are passed over, not marked known; words already begun keep their progress, and the check can be taken again at any time. The answers stay on the server.

Players make further curricula from a source (`POST /api/v1/curricula`):

- **With text** (subtitles in SRT or WebVTT, a transcript, or prose): subtitle markup is removed, every word is matched to its dictionary form ("ran" to "run"), names are left out, and the uncommon words are offered to the tutor, which chooses the best. They are studied in the order they come up, and each keeps the line it appeared in, which becomes a "met in reading" record when a player begins it. Without the tutor, the rarest words are taken.
- **With only a title**: the tutor suggests words from its knowledge of the work, and only words in the dictionary are kept.

On start, `npm run db:seed` loads the data when the file has changed and keeps everyone's progress. To rebuild the data:

```bash
pip install wordfreq
```

```bash
npm install --no-save wndb-with-exceptions && python3 scripts/build-dictionary.py node_modules/wndb-with-exceptions/dict prisma/data/dictionary.json.gz
```

## Rules the server enforces

- **Curriculum order.** Each curriculum offers a player only their next word, and at most three unfinished at once.
- **Challenges.** Daily and weekly challenges are measured from real activity and pay their XP once per period. The shared weekly challenge scales with the number of players and pays everyone when it is met.
- **Three sentences.** A word moves from studying to reviewing only when all three sentence slots have been accepted by the tutor. A sentence must be grammatical, use the word correctly, and show its meaning through context.
- **Scheduling.** Reviews are scheduled by FSRS with a 90% retention target and day-scale intervals. A word is "mastered" once its memory stability reaches 21 days.
- **No XP for busywork.** XP comes from accepted sentences, completing a word's study, correct reviews and mastery. A review is rejected unless the card is due, so reviewing early earns nothing.
