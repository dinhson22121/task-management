-- AlterTable
ALTER TABLE "User" ADD COLUMN "voiceProvider" TEXT NOT NULL DEFAULT 'piper';
ALTER TABLE "User" ADD COLUMN "elevenLabsApiKeyEncrypted" BLOB;
ALTER TABLE "User" ADD COLUMN "elevenLabsVoiceId" TEXT;
