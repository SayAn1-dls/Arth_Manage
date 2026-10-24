-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'NEEDS_REAUTH', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SyncKind" AS ENUM ('SHEETS', 'DRIVE_MIRROR');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "MirrorStatus" AS ENUM ('PENDING', 'MIRRORED', 'FAILED');

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "googleEmail" TEXT NOT NULL,
    "connectedById" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "spreadsheetId" TEXT,
    "spreadsheetUrl" TEXT,
    "tabIds" JSONB NOT NULL DEFAULT '{}',
    "driveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "driveFolders" JSONB NOT NULL DEFAULT '{}',
    "acknowledgedAt" TIMESTAMP(3) NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "lastError" TEXT,
    "lastErrorDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" "SyncKind" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "firstQueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "errorDetail" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveMirror" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "MirrorStatus" NOT NULL DEFAULT 'PENDING',
    "driveFileId" TEXT,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveMirror_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_eventId_key" ON "IntegrationConnection"("eventId");

-- CreateIndex
CREATE INDEX "SyncJob_status_runAfter_idx" ON "SyncJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "SyncJob_eventId_createdAt_idx" ON "SyncJob"("eventId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DriveMirror_eventId_key_key" ON "DriveMirror"("eventId", "key");

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one queued and one running job per connection and kind (coalescing, PRD FR-173).
CREATE UNIQUE INDEX "SyncJob_one_queued" ON "SyncJob" ("connectionId", "kind") WHERE "status" = 'QUEUED';
CREATE UNIQUE INDEX "SyncJob_one_running" ON "SyncJob" ("connectionId", "kind") WHERE "status" = 'RUNNING';
