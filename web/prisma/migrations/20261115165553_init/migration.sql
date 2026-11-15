-- CreateEnum
CREATE TYPE "MorphemeKind" AS ENUM ('PREFIX', 'ROOT', 'SUFFIX');

-- CreateEnum
CREATE TYPE "LearningStage" AS ENUM ('STUDYING', 'REVIEWING', 'MASTERED');

-- CreateEnum
CREATE TYPE "CardState" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING');

-- CreateEnum
CREATE TYPE "SentenceVerdict" AS ENUM ('ACCEPTED', 'NEEDS_REVISION');

-- CreateEnum
CREATE TYPE "ReviewKind" AS ENUM ('DEFINITION_RECALL', 'WORD_FROM_CONTEXT', 'SENTENCE');

-- CreateEnum
CREATE TYPE "XpReason" AS ENUM ('WORD_ADDED', 'SENTENCE_ACCEPTED', 'WORD_STUDIED', 'REVIEW_CORRECT', 'WORD_MASTERED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "client" TEXT NOT NULL DEFAULT 'web',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Word" (
    "id" TEXT NOT NULL,
    "lemma" TEXT NOT NULL,
    "pronunciation" TEXT,
    "partOfSpeech" TEXT,
    "definition" TEXT NOT NULL,
    "etymology" TEXT,
    "relatedForms" TEXT[],
    "synonyms" TEXT[],
    "antonyms" TEXT[],
    "examples" TEXT[],
    "difficulty" INTEGER NOT NULL DEFAULT 3,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Word_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Morpheme" (
    "id" TEXT NOT NULL,
    "kind" "MorphemeKind" NOT NULL,
    "form" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "origin" TEXT,

    CONSTRAINT "Morpheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordMorpheme" (
    "wordId" TEXT NOT NULL,
    "morphemeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "WordMorpheme_pkey" PRIMARY KEY ("wordId","morphemeId")
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceAuthor" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'book',
    "passage" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "stage" "LearningStage" NOT NULL DEFAULT 'STUDYING',
    "introducedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studiedAt" TIMESTAMP(3),
    "masteredAt" TIMESTAMP(3),
    "due" TIMESTAMP(3),
    "stability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fsrsDifficulty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "elapsedDays" INTEGER NOT NULL DEFAULT 0,
    "scheduledDays" INTEGER NOT NULL DEFAULT 0,
    "learningSteps" INTEGER NOT NULL DEFAULT 0,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "cardState" "CardState" NOT NULL DEFAULT 'NEW',
    "lastReview" TIMESTAMP(3),

    CONSTRAINT "UserWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sentence" (
    "id" TEXT NOT NULL,
    "userWordId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "verdict" "SentenceVerdict" NOT NULL,
    "grammarOk" BOOLEAN NOT NULL,
    "usageOk" BOOLEAN NOT NULL,
    "contextOk" BOOLEAN NOT NULL,
    "feedback" TEXT NOT NULL,
    "suggestion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sentence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewLog" (
    "id" TEXT NOT NULL,
    "userWordId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ReviewKind" NOT NULL,
    "rating" INTEGER NOT NULL,
    "stateBefore" "CardState" NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL,
    "fsrsDifficulty" DOUBLE PRECISION NOT NULL,
    "scheduledDays" INTEGER NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" "XpReason" NOT NULL,
    "amount" INTEGER NOT NULL,
    "wordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Word_lemma_key" ON "Word"("lemma");

-- CreateIndex
CREATE UNIQUE INDEX "Morpheme_kind_form_key" ON "Morpheme"("kind", "form");

-- CreateIndex
CREATE INDEX "WordMorpheme_morphemeId_idx" ON "WordMorpheme"("morphemeId");

-- CreateIndex
CREATE INDEX "Encounter_wordId_idx" ON "Encounter"("wordId");

-- CreateIndex
CREATE INDEX "Encounter_userId_idx" ON "Encounter"("userId");

-- CreateIndex
CREATE INDEX "UserWord_userId_due_idx" ON "UserWord"("userId", "due");

-- CreateIndex
CREATE UNIQUE INDEX "UserWord_userId_wordId_key" ON "UserWord"("userId", "wordId");

-- CreateIndex
CREATE INDEX "Sentence_userWordId_slot_idx" ON "Sentence"("userWordId", "slot");

-- CreateIndex
CREATE INDEX "ReviewLog_userId_reviewedAt_idx" ON "ReviewLog"("userId", "reviewedAt");

-- CreateIndex
CREATE INDEX "XpEvent_userId_createdAt_idx" ON "XpEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Word" ADD CONSTRAINT "Word_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordMorpheme" ADD CONSTRAINT "WordMorpheme_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordMorpheme" ADD CONSTRAINT "WordMorpheme_morphemeId_fkey" FOREIGN KEY ("morphemeId") REFERENCES "Morpheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWord" ADD CONSTRAINT "UserWord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWord" ADD CONSTRAINT "UserWord_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWord" ADD CONSTRAINT "UserWord_introducedById_fkey" FOREIGN KEY ("introducedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sentence" ADD CONSTRAINT "Sentence_userWordId_fkey" FOREIGN KEY ("userWordId") REFERENCES "UserWord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_userWordId_fkey" FOREIGN KEY ("userWordId") REFERENCES "UserWord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpEvent" ADD CONSTRAINT "XpEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
