-- CreateTable
CREATE TABLE "JudgeMemo" (
    "assignmentId" TEXT NOT NULL,
    "scratchpad" TEXT NOT NULL DEFAULT '',
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JudgeMemo_pkey" PRIMARY KEY ("assignmentId")
);

-- CreateTable
CREATE TABLE "JudgeBriefing" (
    "eventId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "examples" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JudgeBriefing_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "TrackGlossary" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "trackId" TEXT,
    "term" TEXT NOT NULL,
    "definition" TEXT NOT NULL,

    CONSTRAINT "TrackGlossary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionInsight" (
    "versionId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionInsight_pkey" PRIMARY KEY ("versionId")
);

-- CreateIndex
CREATE INDEX "TrackGlossary_eventId_trackId_idx" ON "TrackGlossary"("eventId", "trackId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackGlossary_eventId_term_key" ON "TrackGlossary"("eventId", "term");

-- AddForeignKey
ALTER TABLE "JudgeMemo" ADD CONSTRAINT "JudgeMemo_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "JudgeAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
