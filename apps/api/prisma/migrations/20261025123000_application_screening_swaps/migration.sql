-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "applicationReview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "departingEmail" TEXT,
ADD COLUMN     "replacementEmail" TEXT;
