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
- **`.gitignore` だけに頼らない**: `.gitignore` は未追跡ファイルにしか効かない。追跡された秘匿ファイルは CI の Secret scan（`.github/workflows/secret-scan.yml`）で検出して落とす。検出対象・除外は同ワークフローが唯一の真実
- **混入したらローテーション**: push 済みのファイルは追跡を外しても履歴に残るため、含まれる鍵・トークンを必ずローテーションする（履歴の書き換えでは対処にならない）
- テンプレート（`.env.example` 等）を追加する場合は、Secret scan の除外に当たる名前（`.example` / `.sample` / `.template` / `.dist`）にする
