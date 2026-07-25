---
description: コーディング規約
globs: 
---

# コーディング規約

- **言語**: TypeScript strict モード（`strict: true`）
- **パッケージマネージャ**: pnpm を使用（npm / yarn は使用しない）
- **Linter / Formatter**: ESLint 9 + Prettier でコード品質を担保
- **CI で機械強制**: `quality` ジョブが `pnpm lint` / `pnpm format:check` / `pnpm typecheck` を実行する。ローカル実行に依存しない
- **Prettier の対象は `front/` 配下全体**（`prettier --write .`）。除外は `front/.prettierignore` で管理する（生成物・テスト成果物・ロックファイル）
- **整形コミットは分離する**: 整形と機能変更を同じコミットに混ぜない。整形のみのコミットは `.git-blame-ignore-revs` に登録し、`git config blame.ignoreRevsFile .git-blame-ignore-revs` で blame から除外できる状態にする
- **環境変数**: 設定値は環境変数で管理（`front/.env.local`）
- **シークレット禁止**: シークレット・認証情報をハードコードしない
- **コード配置**: 開発コードは全て `front/` ディレクトリ内に配置する
- **base/ は読み取り専用**: `base/` ディレクトリのファイルは編集・追加・削除しない
