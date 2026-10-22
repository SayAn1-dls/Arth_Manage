-- CreateEnum
CREATE TYPE "FeedbackAudience" AS ENUM ('PARTICIPANT', 'JUDGE');

-- CreateEnum
CREATE TYPE "FormState" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CertParticipationRule" AS ENUM ('SUBMITTED', 'CHECKED_IN');

-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('PARTICIPATION', 'WINNER');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('GENERATED', 'NEEDS_REGENERATION', 'RELEASED', 'REVOKED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "commentHiddenReason" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "certParticipationRule" "CertParticipationRule" NOT NULL DEFAULT 'SUBMITTED',
ADD COLUMN     "certWinnersAlsoParticipate" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Round" ADD COLUMN     "commentsReleasedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FeedbackForm" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "audience" "FeedbackAudience" NOT NULL,
    "state" "FormState" NOT NULL DEFAULT 'DRAFT',
    "confidential" BOOLEAN NOT NULL,
    "closeAt" TIMESTAMP(3),
    "questions" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackResponse" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "respondentMembershipId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateTemplate" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "CertificateType" NOT NULL,
    "backgroundKey" TEXT,
    "backgroundName" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "awardTexts" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "certificateCode" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" "CertificateType" NOT NULL,
    "awardKey" TEXT NOT NULL DEFAULT '',
    "awardText" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "teamName" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "CertificateStatus" NOT NULL DEFAULT 'GENERATED',
    "pdfKey" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "flaggedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NameCorrection" (
    "id" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "requestedName" TEXT NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NameCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateException" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" "CertificateType" NOT NULL,
    "include" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateJob" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "CertificateType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'RUNNING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CertificateJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackForm_eventId_audience_key" ON "FeedbackForm"("eventId", "audience");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackResponse_formId_respondentMembershipId_key" ON "FeedbackResponse"("formId", "respondentMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "CertificateTemplate_eventId_type_key" ON "CertificateTemplate"("eventId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_certificateCode_key" ON "Certificate"("certificateCode");

-- CreateIndex
CREATE INDEX "Certificate_eventId_type_status_idx" ON "Certificate"("eventId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_eventId_membershipId_type_awardKey_key" ON "Certificate"("eventId", "membershipId", "type", "awardKey");

-- CreateIndex
CREATE UNIQUE INDEX "CertificateException_eventId_membershipId_type_key" ON "CertificateException"("eventId", "membershipId", "type");

-- CreateIndex
CREATE INDEX "CertificateJob_eventId_type_idx" ON "CertificateJob"("eventId", "type");

-- AddForeignKey
ALTER TABLE "FeedbackResponse" ADD CONSTRAINT "FeedbackResponse_formId_fkey" FOREIGN KEY ("formId") REFERENCES "FeedbackForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NameCorrection" ADD CONSTRAINT "NameCorrection_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Integrity rules ──
-- Certificates reference membership ids; keep them inside the event with composite keys.
ALTER TABLE "Certificate" ADD CONSTRAINT certificate_member_same_event
  FOREIGN KEY ("membershipId", "eventId") REFERENCES "EventMembership" (id, "eventId") ON DELETE CASCADE;
ALTER TABLE "CertificateException" ADD CONSTRAINT cert_exception_member_same_event
  FOREIGN KEY ("membershipId", "eventId") REFERENCES "EventMembership" (id, "eventId") ON DELETE CASCADE;
ALTER TABLE "CertificateException" ADD CONSTRAINT cert_exception_reason CHECK (char_length(reason) >= 3);
ALTER TABLE "FeedbackForm" ADD CONSTRAINT feedback_form_question_limit CHECK (jsonb_array_length(questions) <= 15);
