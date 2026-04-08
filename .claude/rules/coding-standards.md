---
description: コーディング規約
globs: 
---

# コーディング規約

- **言語**: TypeScript strict モード（`strict: true`）
- **パッケージマネージャ**: pnpm を使用（npm / yarn は使用しない）
- **Linter / Formatter**: ESLint 9 + Prettier でコード品質を担保
- **環境変数**: 設定値は環境変数で管理（`front/.env.local`）
- **シークレット禁止**: シークレット・認証情報をハードコードしない
- **コード配置**: 開発コードは全て `front/` ディレクトリ内に配置する
- **base/ は読み取り専用**: `base/` ディレクトリのファイルは編集・追加・削除しない
