---
description: セキュリティ設計方針（認証・通信・インジェクション対策・シークレット管理）
globs: 
---

# セキュリティ

## 認証・認可

- **認証不要**（localhost 個人利用のため）。

## インジェクション対策

- **SQL インジェクション**: Prisma Client のパラメータバインディングを必須とする。`$queryRaw` での文字列結合は禁止。
- **XSS**: 生の HTML 埋め込みは禁止。Reactの標準エスケープを活用。Markdown表示は `react-markdown` を使用（HTML パースなし）。
- **CSP**: `next.config.ts` で CSP ヘッダーを設定する。

## シークレット管理

- ローカル環境: `front/.env.local`（`.gitignore` に追加済み）
- シークレット・認証情報をコードにハードコードしない
