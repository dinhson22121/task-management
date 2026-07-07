-- AlterTable
ALTER TABLE "IntegrationConnection" ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'oauth';
ALTER TABLE "IntegrationConnection" ADD COLUMN "email" TEXT;
