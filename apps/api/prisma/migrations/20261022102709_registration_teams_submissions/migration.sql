-- CreateEnum
CREATE TYPE "RegistrationFieldType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'SELECT', 'URL', 'CHECKBOX');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('ACTIVE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'DISSOLVED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('LEADER', 'MEMBER');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SubmissionFieldType" AS ENUM ('FILE', 'REPO_URL', 'VIDEO_URL', 'LIVE_URL', 'OTHER_URL', 'SHORT_TEXT', 'LONG_TEXT');

-- CreateTable
CREATE TABLE "RegistrationFieldDef" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "RegistrationFieldType" NOT NULL,
    "helpText" TEXT,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RegistrationFieldDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "institution" TEXT NOT NULL,
    "course" TEXT,
    "yearOfStudy" TEXT,
    "certificateName" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "declarationsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "teamCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trackId" TEXT,
    "problemId" TEXT,
    "joinCode" TEXT,
    "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "disqualifiedReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JoinAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JoinAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "EventRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionFormField" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "type" "SubmissionFieldType" NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "allowedExtensions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxMb" INTEGER NOT NULL DEFAULT 25,

    CONSTRAINT "SubmissionFormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "draftTitle" TEXT NOT NULL DEFAULT '',
    "draftSummary" TEXT NOT NULL DEFAULT '',
    "draftValues" JSONB NOT NULL DEFAULT '{}',
    "draftVersion" INTEGER NOT NULL DEFAULT 1,
    "draftUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVersionNo" INTEGER NOT NULL DEFAULT 0,
    "extensionDeadline" TIMESTAMP(3),
    "extensionReason" TEXT,
    "minSizeOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionVersion" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedByMembershipId" TEXT NOT NULL,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SubmissionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionFile" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationFieldDef_eventId_label_key" ON "RegistrationFieldDef"("eventId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_membershipId_key" ON "Registration"("membershipId");

-- CreateIndex
CREATE INDEX "Registration_eventId_idx" ON "Registration"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_membershipId_eventId_key" ON "Registration"("membershipId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_eventId_teamCode_key" ON "Team"("eventId", "teamCode");

-- CreateIndex
CREATE UNIQUE INDEX "Team_eventId_joinCode_key" ON "Team"("eventId", "joinCode");

-- CreateIndex
CREATE UNIQUE INDEX "Team_id_eventId_key" ON "Team"("id", "eventId");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");

-- CreateIndex
CREATE INDEX "TeamMember_eventId_membershipId_idx" ON "TeamMember"("eventId", "membershipId");

-- CreateIndex
CREATE INDEX "JoinAttempt_userId_eventId_at_idx" ON "JoinAttempt"("userId", "eventId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_eventId_status_idx" ON "Invitation"("eventId", "status");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionFormField_roundId_label_key" ON "SubmissionFormField"("roundId", "label");

-- CreateIndex
CREATE INDEX "Submission_eventId_idx" ON "Submission"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_roundId_teamId_key" ON "Submission"("roundId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionVersion_submissionId_versionNo_key" ON "SubmissionVersion"("submissionId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionFile_storageKey_key" ON "SubmissionFile"("storageKey");

-- CreateIndex
CREATE INDEX "SubmissionFile_submissionId_idx" ON "SubmissionFile"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "EventMembership_id_eventId_key" ON "EventMembership"("id", "eventId");

-- AddForeignKey
ALTER TABLE "RegistrationFieldDef" ADD CONSTRAINT "RegistrationFieldDef_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_membershipId_eventId_fkey" FOREIGN KEY ("membershipId", "eventId") REFERENCES "EventMembership"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "ProblemStatement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_eventId_fkey" FOREIGN KEY ("teamId", "eventId") REFERENCES "Team"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_membershipId_eventId_fkey" FOREIGN KEY ("membershipId", "eventId") REFERENCES "EventMembership"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFormField" ADD CONSTRAINT "SubmissionFormField_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionVersion" ADD CONSTRAINT "SubmissionVersion_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFile" ADD CONSTRAINT "SubmissionFile_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Integrity rules the database enforces itself (PRD 9.3) ──

-- A participant belongs to at most one active team per event (PRD FR-055): the race-proof guarantee.
CREATE UNIQUE INDEX team_member_one_active_team ON "TeamMember" ("eventId", "membershipId") WHERE "leftAt" IS NULL;
-- Exactly one active leader per team.
CREATE UNIQUE INDEX team_one_active_leader ON "TeamMember" ("teamId") WHERE role = 'LEADER' AND "leftAt" IS NULL;
-- Team names are unique within an event, case-insensitively, among non-dissolved teams (PRD FR-052).
CREATE UNIQUE INDEX team_name_unique_per_event ON "Team" ("eventId", lower(name)) WHERE status <> 'DISSOLVED';
ALTER TABLE "Team" ADD CONSTRAINT team_name_length CHECK (char_length(name) BETWEEN 3 AND 40);

ALTER TABLE "SubmissionFormField" ADD CONSTRAINT submission_field_max_mb CHECK ("maxMb" BETWEEN 1 AND 50);
ALTER TABLE "Submission" ADD CONSTRAINT submission_draft_summary_len CHECK (char_length("draftSummary") <= 1500);

-- Submitted versions and stored files are immutable: no UPDATE or DELETE, ever (PRD 9.3-4).
CREATE OR REPLACE FUNCTION immutable_rows() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submission_version_immutable BEFORE UPDATE OR DELETE ON "SubmissionVersion"
FOR EACH ROW EXECUTE FUNCTION immutable_rows();
CREATE TRIGGER submission_file_immutable BEFORE UPDATE OR DELETE ON "SubmissionFile"
FOR EACH ROW EXECUTE FUNCTION immutable_rows();
