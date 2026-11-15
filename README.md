# Lexicon

A private vocabulary learning app for a couple or a small group. Lexicon helps them expand their English vocabulary together through structured study, active recall, spaced repetition, and friendly competition.

The goal is not simply to memorize definitions, but to understand words deeply: their origins, their construction, and how to use them naturally in speech and writing.

## Core features

### 1. Vocabulary discovery and study

Users work through a shared curriculum of words, the same words in the same order for everyone, and add words they encounter while reading. Each word has a study page with:

- Definition and pronunciation
- Etymology and historical origins
- Prefixes, roots, and suffixes, where applicable
- Part of speech and related word forms
- Synonyms, antonyms, and example usages
- Connections to other words with similar linguistic roots

### 2. Five-sentence learning method

After studying a word, the user writes five original sentences demonstrating their understanding. An AI tutor evaluates each sentence for grammatical correctness, contextual appropriateness, and accurate usage of the word. It gives constructive feedback, explains mistakes, and encourages revisions.

### 3. Long-term spaced repetition

An Anki-inspired spaced repetition system, preferably FSRS, schedules reviews from each user's own memory performance. Reviews include definition recall, identifying words from context, and occasionally constructing original sentences. The objective is lifelong retention rather than short-term memorization.

### 4. Shared learning experience

All users share one vocabulary collection but keep independent learning progress, review schedules, and mastery levels. Users can introduce words to each other, see what the others are studying, and take part in shared vocabulary challenges.

### 5. Friendly competition

A private leaderboard encourages consistent learning through:

- Experience points (XP)
- Daily and weekly challenges
- Learning streaks
- Words mastered
- Correctly completed reviews
- Achievements and milestones

Competition should reward genuine understanding and consistency rather than excessive activity.

### 6. Vocabulary library and progress tracking

A personal library organizes words by familiarity, mastery, difficulty, and linguistic relationships. A dashboard visualizes vocabulary growth over time, retention, review performance, and individual accomplishments.

### 7. Reading integration

Users can record where they encountered a word (the book, passage, or article), connecting vocabulary study to real reading.

## Design philosophy

Lexicon should feel like a thoughtfully designed personal learning companion rather than a conventional flashcard app. The interface should be elegant, minimalist, warm, and intellectually engaging, drawing subtle inspiration from classical literature, old dictionaries, and scholarly libraries.

## Ultimate goal

Transform unfamiliar words into vocabulary that both users can confidently recognize, recall, understand, and use for the rest of their lives.

## Deploying with Docker

The repository includes everything needed to run Lexicon on your own server: the app and its Postgres database, started together by Docker Compose.

```bash
git clone https://github.com/chubbymomo/Lexicon.git
```

```bash
cd Lexicon && cp .env.example .env
```

Edit `.env`: set `POSTGRES_PASSWORD` and `LEXICON_INVITE_CODE`, and `ANTHROPIC_API_KEY` to enable the AI tutor. Then build and start:

```bash
docker compose up -d --build
```

Lexicon is then at `http://<your-server>:3000` (change the port with `LEXICON_PORT`). On each start the app applies database migrations and loads the curriculum, so there is no separate setup step. Each person opens the site, chooses "Create an account" and enters the invite code.

- **Updating:** `git pull`, then `docker compose up -d --build` again. Data is kept.
- **Your data** lives in the `db-data` Docker volume. Back it up with `docker compose exec db pg_dump -U lexicon lexicon > backup.sql`. `docker compose down -v` deletes it.
- **Logs:** `docker compose logs -f app`.
- **HTTPS:** the app serves plain HTTP. For access from outside your home network, put a reverse proxy that provides HTTPS (Caddy, nginx, Traefik) in front of port 3000. The Android app will need the HTTPS address. Sign-in works either way: cookies are marked secure automatically when the request arrives over HTTPS.

## Repository layout

| Path | Contents |
| --- | --- |
| [`web/`](web/) | The web app and the HTTP API (Next.js, Postgres, FSRS, Claude). Start with [`web/README.md`](web/README.md). |
| [`openapi/openapi.json`](openapi/openapi.json) | The API contract every client is built against. |
| [`docker-compose.yml`](docker-compose.yml), [`.env.example`](.env.example) | Self-hosted deployment. |
| [`android/`](android/) | The Android app, a client of the same API. |

All scheduling, scoring and AI evaluation run on the server, so the web and Android apps always agree.
