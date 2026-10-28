-- AlterTable
ALTER TABLE "EventMembership" ADD COLUMN     "accessLevel" TEXT NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "institution" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "trackIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Round" ADD COLUMN     "normalisation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shortlistEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "applicationNote" TEXT,
ADD COLUMN     "applicationStatus" TEXT NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "teamId" TEXT,
    "subject" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'QUESTION',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "roundId" TEXT,
    "minutes" INTEGER NOT NULL DEFAULT 10,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundEntry" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoundEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryProfile" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "skills" TEXT NOT NULL,
    "about" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityPulse" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guidebookAt" TIMESTAMP(3),

    CONSTRAINT "ActivityPulse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectReview" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "repoUrl" TEXT,
    "integrityNote" TEXT NOT NULL DEFAULT '',
    "marketNote" TEXT NOT NULL DEFAULT '',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "releaseToTeam" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportTicket_eventId_status_updatedAt_idx" ON "SupportTicket"("eventId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "SupportTicket_eventId_authorId_idx" ON "SupportTicket"("eventId", "authorId");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "RoundEntry_eventId_roundId_idx" ON "RoundEntry"("eventId", "roundId");

-- CreateIndex
CREATE UNIQUE INDEX "RoundEntry_roundId_teamId_key" ON "RoundEntry"("roundId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryProfile_eventId_membershipId_key" ON "DiscoveryProfile"("eventId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityPulse_eventId_membershipId_key" ON "ActivityPulse"("eventId", "membershipId");

-- CreateIndex
CREATE INDEX "MessageDelivery_status_createdAt_idx" ON "MessageDelivery"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDelivery_eventId_membershipId_key_key" ON "MessageDelivery"("eventId", "membershipId", "key");

-- CreateIndex
CREATE INDEX "ProjectReview_eventId_idx" ON "ProjectReview"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectReview_roundId_teamId_key" ON "ProjectReview"("roundId", "teamId");

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
