-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('APPROVED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "TieMode" AS ENUM ('SHARE', 'ORDER');

-- CreateEnum
CREATE TYPE "StaffTaskType" AS ENUM ('CHECKIN', 'VERIFICATION', 'GENERAL');

-- CreateEnum
CREATE TYPE "StaffTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "IssueCategory" AS ENUM ('REGISTRATION_MISMATCH', 'TECHNICAL', 'FACILITIES', 'CONDUCT', 'OTHER');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- DropForeignKey
ALTER TABLE "JudgeAssignment" DROP CONSTRAINT "assignment_judge_same_event";

-- DropForeignKey
ALTER TABLE "JudgeAssignment" DROP CONSTRAINT "assignment_team_same_event";

-- CreateTable
CREATE TABLE "ResultSnapshot" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "entries" JSONB NOT NULL,
    "unranked" JSONB NOT NULL,
    "tieDecisions" JSONB NOT NULL,
    "exclusions" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SnapshotStatus" NOT NULL DEFAULT 'APPROVED',
    "invalidatedAt" TIMESTAMP(3),
    "invalidatedReason" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "unpublishedAt" TIMESTAMP(3),
    "unpublishReason" TEXT,

    CONSTRAINT "ResultSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TieResolution" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "teamIds" TEXT[],
    "mode" "TieMode" NOT NULL,
    "order" TEXT[],
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TieResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotRankedMark" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotRankedMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTask" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "StaffTaskType" NOT NULL DEFAULT 'GENERAL',
    "dueAt" TIMESTAMP(3),
    "location" TEXT,
    "status" "StaffTaskStatus" NOT NULL DEFAULT 'TODO',
    "note" TEXT,
    "statusChangedById" TEXT,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTaskAssignee" (
    "taskId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,

    CONSTRAINT "StaffTaskAssignee_pkey" PRIMARY KEY ("taskId","membershipId")
);

-- CreateTable
CREATE TABLE "StaffTaskTeam" (
    "taskId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "StaffTaskTeam_pkey" PRIMARY KEY ("taskId","teamId")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedInById" TEXT NOT NULL,
    "idVerifiedAt" TIMESTAMP(3),
    "idVerifiedById" TEXT,
    "note" TEXT,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueReport" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "reporterMembershipId" TEXT NOT NULL,
    "category" "IssueCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "teamId" TEXT,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'NORMAL',
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResultSnapshot_eventId_roundId_idx" ON "ResultSnapshot"("eventId", "roundId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultSnapshot_roundId_versionNo_key" ON "ResultSnapshot"("roundId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "TieResolution_roundId_group_rank_key" ON "TieResolution"("roundId", "group", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "NotRankedMark_roundId_teamId_key" ON "NotRankedMark"("roundId", "teamId");

-- CreateIndex
CREATE INDEX "StaffTask_eventId_status_idx" ON "StaffTask"("eventId", "status");

-- CreateIndex
CREATE INDEX "StaffTaskAssignee_membershipId_idx" ON "StaffTaskAssignee"("membershipId");

-- CreateIndex
CREATE INDEX "CheckIn_eventId_membershipId_idx" ON "CheckIn"("eventId", "membershipId");

-- CreateIndex
CREATE INDEX "IssueReport_eventId_status_idx" ON "IssueReport"("eventId", "status");

-- AddForeignKey
ALTER TABLE "ResultSnapshot" ADD CONSTRAINT "ResultSnapshot_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TieResolution" ADD CONSTRAINT "TieResolution_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotRankedMark" ADD CONSTRAINT "NotRankedMark_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTaskAssignee" ADD CONSTRAINT "StaffTaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "StaffTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTaskTeam" ADD CONSTRAINT "StaffTaskTeam_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "StaffTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueReport" ADD CONSTRAINT "IssueReport_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Integrity rules the database enforces itself ──

-- An approved result snapshot's content never changes (PRD 9.3-4, FR-034). Only status, invalidation and
-- publication bookkeeping may be updated; deleting a snapshot is never allowed.
CREATE OR REPLACE FUNCTION result_snapshot_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'result snapshots cannot be deleted';
  END IF;
  IF NEW."eventId" IS DISTINCT FROM OLD."eventId"
     OR NEW."roundId" IS DISTINCT FROM OLD."roundId"
     OR NEW."versionNo" IS DISTINCT FROM OLD."versionNo"
     OR NEW.entries IS DISTINCT FROM OLD.entries
     OR NEW.unranked IS DISTINCT FROM OLD.unranked
     OR NEW."tieDecisions" IS DISTINCT FROM OLD."tieDecisions"
     OR NEW.exclusions IS DISTINCT FROM OLD.exclusions
     OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
     OR NEW."approvedById" IS DISTINCT FROM OLD."approvedById"
     OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" THEN
    RAISE EXCEPTION 'approved result snapshot content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER result_snapshot_immutable BEFORE UPDATE OR DELETE ON "ResultSnapshot"
FOR EACH ROW EXECUTE FUNCTION result_snapshot_guard();

-- A participant is checked in at most once at a time; undo keeps history (PRD FR-126).
CREATE UNIQUE INDEX check_in_one_active ON "CheckIn" ("eventId", "membershipId") WHERE "undoneAt" IS NULL;
-- Tie resolution reasons need substance (PRD FR-033).
ALTER TABLE "TieResolution" ADD CONSTRAINT tie_reason_length CHECK (char_length(reason) >= 10);
