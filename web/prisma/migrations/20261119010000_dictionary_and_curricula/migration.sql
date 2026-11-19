-- CreateEnum
CREATE TYPE "TrackKind" AS ENUM ('CORE', 'SOURCE');

-- AlterEnum
ALTER TYPE "LearningStage" ADD VALUE 'KNOWN';

-- DropIndex
DROP INDEX "Word_curriculumPosition_key";

-- AlterTable
ALTER TABLE "Word" DROP COLUMN "curriculumPosition",
ADD COLUMN     "enrichedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DictionaryEntry" (
    "lemma" TEXT NOT NULL,
    "partOfSpeech" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "synonyms" TEXT[],
    "antonyms" TEXT[],
    "examples" TEXT[],
    "zipf" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DictionaryEntry_pkey" PRIMARY KEY ("lemma")
);

-- CreateTable
CREATE TABLE "WordForm" (
    "form" TEXT NOT NULL,
    "lemma" TEXT NOT NULL,

    CONSTRAINT "WordForm_pkey" PRIMARY KEY ("form")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "kind" "TrackKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceKind" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackItem" (
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "lemma" TEXT NOT NULL,
    "context" TEXT,

    CONSTRAINT "TrackItem_pkey" PRIMARY KEY ("trackId","position")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "TrackItem_lemma_idx" ON "TrackItem"("lemma");

-- CreateIndex
CREATE UNIQUE INDEX "TrackItem_trackId_lemma_key" ON "TrackItem"("trackId", "lemma");

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackItem" ADD CONSTRAINT "TrackItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Words that already have an etymology need no enrichment from the tutor.
UPDATE "Word" SET "enrichedAt" = "createdAt" WHERE "etymology" IS NOT NULL;
