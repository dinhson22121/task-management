-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "removedFromActiveAt" DATETIME;
ALTER TABLE "Ticket" ADD COLUMN "deletedAt" DATETIME;
