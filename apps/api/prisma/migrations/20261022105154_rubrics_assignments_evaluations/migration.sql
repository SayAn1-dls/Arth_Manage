-- CreateEnum
CREATE TYPE "JudgingStatus" AS ENUM ('NOT_OPEN', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "RubricState" AS ENUM ('DRAFT', 'ACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "CommentMode" AS ENUM ('OFF', 'OPTIONAL', 'REQUIRED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'CONFLICT', 'EXCLUDED', 'UNASSIGNED');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REOPENED');

-- AlterTable
ALTER TABLE "Round" ADD COLUMN     "judgingStatus" "JudgingStatus" NOT NULL DEFAULT 'NOT_OPEN';

-- CreateTable
CREATE TABLE "Rubric" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" "RubricState" NOT NULL DEFAULT 'DRAFT',
    "teamCommentMode" "CommentMode" NOT NULL DEFAULT 'OPTIONAL',
    "sourceTemplate" TEXT,
    "structureVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rubric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubricCriterion" (
    "id" TEXT NOT NULL,
    "rubricId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "weight" INTEGER NOT NULL,
    "min" INTEGER NOT NULL,
    "max" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RubricCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeAssignment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "judgeMembershipId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "conflictDeclaredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudgeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "structureVersion" INTEGER NOT NULL DEFAULT 1,
    "weightedScore" DECIMAL(9,4),
    "teamComment" TEXT,
    "privateNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "correctionReason" TEXT,
    "correctionRequestedAt" TIMESTAMP(3),
    "correctionDeclinedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionScore" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "CriterionScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationVersion" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "scores" JSONB NOT NULL,
    "criteria" JSONB NOT NULL,
    "teamComment" TEXT,
    "privateNote" TEXT,
    "weightedScore" DECIMAL(9,4) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rubric_roundId_key" ON "Rubric"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "RubricCriterion_rubricId_name_key" ON "RubricCriterion"("rubricId", "name");

-- CreateIndex
CREATE INDEX "JudgeAssignment_judgeMembershipId_roundId_idx" ON "JudgeAssignment"("judgeMembershipId", "roundId");

-- CreateIndex
CREATE INDEX "JudgeAssignment_eventId_roundId_idx" ON "JudgeAssignment"("eventId", "roundId");

-- CreateIndex
CREATE UNIQUE INDEX "JudgeAssignment_roundId_teamId_judgeMembershipId_key" ON "JudgeAssignment"("roundId", "teamId", "judgeMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_assignmentId_key" ON "Evaluation"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CriterionScore_evaluationId_criterionId_key" ON "CriterionScore"("evaluationId", "criterionId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationVersion_evaluationId_versionNo_key" ON "EvaluationVersion"("evaluationId", "versionNo");

-- AddForeignKey
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricCriterion" ADD CONSTRAINT "RubricCriterion_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT "JudgeAssignment_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "JudgeAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionScore" ADD CONSTRAINT "CriterionScore_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionScore" ADD CONSTRAINT "CriterionScore_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "RubricCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationVersion" ADD CONSTRAINT "EvaluationVersion_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Integrity rules the database enforces itself ──

-- Rubric criterion limits (PRD FR-142/143).
ALTER TABLE "RubricCriterion" ADD CONSTRAINT criterion_weight CHECK (weight BETWEEN 1 AND 100);
ALTER TABLE "RubricCriterion" ADD CONSTRAINT criterion_range CHECK (min IN (0, 1) AND max > min AND max <= 100);
ALTER TABLE "RubricCriterion" ADD CONSTRAINT criterion_text CHECK (char_length(name) BETWEEN 1 AND 60 AND char_length(description) <= 500);

-- An assignment's team and judge must belong to the assignment's event, and the judge must hold the JUDGE role.
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT assignment_team_same_event
  FOREIGN KEY ("teamId", "eventId") REFERENCES "Team" (id, "eventId") ON DELETE CASCADE;
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT assignment_judge_same_event
  FOREIGN KEY ("judgeMembershipId", "eventId") REFERENCES "EventMembership" (id, "eventId") ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION assignment_requires_judge_role() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EventMembership" WHERE id = NEW."judgeMembershipId" AND role = 'JUDGE') THEN
    RAISE EXCEPTION 'only a judge can be assigned to evaluate';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER judge_assignment_role_check BEFORE INSERT ON "JudgeAssignment"
FOR EACH ROW EXECUTE FUNCTION assignment_requires_judge_role();

-- Scores stay within the weighted-score range and each submitted evaluation version is immutable.
ALTER TABLE "Evaluation" ADD CONSTRAINT evaluation_score_range CHECK ("weightedScore" IS NULL OR ("weightedScore" >= 0 AND "weightedScore" <= 100));
ALTER TABLE "CriterionScore" ADD CONSTRAINT criterion_score_nonneg CHECK (score >= 0);
ALTER TABLE "EvaluationVersion" ADD CONSTRAINT evaluation_version_score_range CHECK ("weightedScore" >= 0 AND "weightedScore" <= 100);
CREATE TRIGGER evaluation_version_immutable BEFORE UPDATE OR DELETE ON "EvaluationVersion"
FOR EACH ROW EXECUTE FUNCTION immutable_rows();
