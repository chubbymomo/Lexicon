-- AlterEnum
ALTER TYPE "XpReason" ADD VALUE 'CHALLENGE_COMPLETED';

-- DropForeignKey
ALTER TABLE "Word" DROP CONSTRAINT "Word_addedById_fkey";

-- AlterTable
ALTER TABLE "Word" ADD COLUMN     "curriculumPosition" INTEGER,
ALTER COLUMN "addedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "XpEvent" ADD COLUMN     "key" TEXT;

-- CreateTable
CREATE TABLE "Achievement" (
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("userId","code")
);

-- CreateIndex
CREATE UNIQUE INDEX "Word_curriculumPosition_key" ON "Word"("curriculumPosition");

-- CreateIndex
CREATE UNIQUE INDEX "XpEvent_userId_key_key" ON "XpEvent"("userId", "key");

-- AddForeignKey
ALTER TABLE "Word" ADD CONSTRAINT "Word_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

