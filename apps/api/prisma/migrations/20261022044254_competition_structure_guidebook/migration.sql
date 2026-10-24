-- CreateEnum
CREATE TYPE "LatePolicy" AS ENUM ('REJECT', 'ACCEPT_AND_FLAG');

-- CreateEnum
CREATE TYPE "RankingScope" AS ENUM ('OVERALL', 'PER_TRACK');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('EVERYONE', 'PARTICIPANTS', 'JUDGES', 'STAFF');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "declarations" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "trackRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemStatement" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "trackId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProblemStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Round" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3),
    "submissionDeadline" TIMESTAMP(3),
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "latePolicy" "LatePolicy" NOT NULL DEFAULT 'REJECT',
    "judgingDeadline" TIMESTAMP(3),
    "rankingScope" "RankingScope" NOT NULL DEFAULT 'OVERALL',
    "requiredEvaluations" INTEGER NOT NULL DEFAULT 2,
    "awardPositions" INTEGER NOT NULL DEFAULT 3,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guidebook" (
    "eventId" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guidebook_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "GuidebookVersion" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "sections" JSONB NOT NULL,
    "changeNote" TEXT,
    "publishedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuidebookVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'EVERYONE',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Track_eventId_name_key" ON "Track"("eventId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemStatement_eventId_title_key" ON "ProblemStatement"("eventId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "Round_eventId_order_key" ON "Round"("eventId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "GuidebookVersion_eventId_versionNo_key" ON "GuidebookVersion"("eventId", "versionNo");

-- CreateIndex
CREATE INDEX "Announcement_eventId_createdAt_idx" ON "Announcement"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemStatement" ADD CONSTRAINT "ProblemStatement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemStatement" ADD CONSTRAINT "ProblemStatement_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guidebook" ADD CONSTRAINT "Guidebook_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidebookVersion" ADD CONSTRAINT "GuidebookVersion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Round invariants (PRD FR-012): opens < submission deadline <= judging deadline; bounded grace and evaluations.
ALTER TABLE "Round" ADD CONSTRAINT round_grace_bounds CHECK ("graceMinutes" BETWEEN 0 AND 60);
ALTER TABLE "Round" ADD CONSTRAINT round_required_evaluations CHECK ("requiredEvaluations" BETWEEN 1 AND 5);
ALTER TABLE "Round" ADD CONSTRAINT round_award_positions CHECK ("awardPositions" BETWEEN 1 AND 10);
ALTER TABLE "Round" ADD CONSTRAINT round_dates_ordered CHECK (
  ("opensAt" IS NULL OR "submissionDeadline" IS NULL OR "opensAt" < "submissionDeadline")
  AND ("submissionDeadline" IS NULL OR "judgingDeadline" IS NULL OR "submissionDeadline" <= "judgingDeadline")
);
-- Event limits (PRD FR-014/FR-013): team size 1-10, at most five declarations.
ALTER TABLE "Event" DROP CONSTRAINT event_team_size;
ALTER TABLE "Event" ADD CONSTRAINT event_team_size CHECK ("teamMin" >= 1 AND "teamMax" >= "teamMin" AND "teamMax" <= 10);
ALTER TABLE "Event" ADD CONSTRAINT event_declaration_count CHECK (cardinality("declarations") <= 5);
