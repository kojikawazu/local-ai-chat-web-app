-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "forkedFromMessageId" TEXT;

-- CreateIndex
CREATE INDEX "Conversation_forkedFromMessageId_idx" ON "Conversation"("forkedFromMessageId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_forkedFromMessageId_fkey" FOREIGN KEY ("forkedFromMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
