-- AlterTable: Message に metadata カラムを追加
-- ツール呼び出し情報を格納する nullable な JSON フィールド
ALTER TABLE "Message" ADD COLUMN "metadata" JSONB;
