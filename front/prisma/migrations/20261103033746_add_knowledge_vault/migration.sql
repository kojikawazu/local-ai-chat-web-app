-- AlterTable
ALTER TABLE "KnowledgeDocument" ADD COLUMN     "sourceHash" TEXT,
ADD COLUMN     "vault" TEXT;

-- CreateIndex
CREATE INDEX "KnowledgeDocument_vault_idx" ON "KnowledgeDocument"("vault");
