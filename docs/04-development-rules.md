# 開発ルール

> 最終更新: 2026-10-31

## 目次

- [ディレクトリルール（最重要）](#ディレクトリルール最重要)
- [開発手法](#開発手法)
- [ドキュメント更新ルール](#ドキュメント更新ルール)
- [Git運用](#git運用)
- [テスト方針](#テスト方針)
  - [テストファイル配置](#テストファイル配置)
  - [CI（GitHub Actions）](#cigithub-actions)
- [コード品質](#コード品質)
- [技術規約](#技術規約)

## ディレクトリルール（最重要）

- **`base/` は読み取り専用**。ファイルの編集・追加・削除を絶対にしない。デザインリファレンスとしての参照のみ。
- **開発コードは全て `front/` ディレクトリ内に配置する**。Next.jsプロジェクト、設定ファイル、テスト等すべて `front/` 内で管理する。
- コマンド実行は `front/` ディレクトリ内で行う。

## 開発手法

**タスク駆動開発**を採用する。

1. タスクを `docs/07-tasks.md` にチェックリスト形式で管理する
2. タスクを1つずつ消化し、完了したら `[x]` に更新する
3. 新規タスクの追加・完了時は必ず `docs/07-tasks.md` を更新する
4. 指示ルールが変更・追加された場合は `CLAUDE.md` も必ず更新する

## ドキュメント更新ルール

| トリガー | 更新対象 |
|---------|---------|
| タスクの追加・着手・完了 | `docs/07-tasks.md` |
| 開発ルール・指示の変更 | `CLAUDE.md` + 該当docsファイル |
| 要件の追加・変更 | `docs/01-requirements.md` |
| 設計の変更 | `docs/02-architecture.md` or `docs/03-api-design.md` |

## Git運用

- **feature branch** 方式で運用する
- ブランチ名: `<種別>/<名前>`（例: `feature/chat-streaming`, `fix/validate-json-body`, `docs/setup-guide-macos`）。種別は変更の主目的で選ぶ:

  | 種別 | 用途 |
  |---|---|
  | `feature` | 機能の追加・改善 |
  | `fix` | バグ修正 |
  | `chore` | ビルド・設定・依存関係・CI・リポジトリ管理 |
  | `docs` | ドキュメントのみの変更 |
  | `test` | テストのみの追加・修正 |
- mainブランチに直接コミットしない（初回セットアップ時を除く）
- **コミットメッセージは日本語**で記述する
- PRはGitHub Actionsの自動テスト通過後にマージ
- **GitHub issue 運用**: 作業ブランチを切るのと対で issue を起票し、open/close で進捗を管理する。PR 本文に `Closes #<issue番号>` を記載して自動クローズする。詳細は `.claude/rules/github-issue.md` を参照

## テスト方針

- **E2Eテスト**を必須とする（Playwright使用）
- コンポーネント単位のユニットテストは不要
- テスト観点:
  - **正常系**: 期待通りの動作確認
  - **準正常系**: 境界値、空入力、長文入力等
  - **異常系**: エラーハンドリング、通信失敗等
  - **画面操作**: ボタン押下、キーボード操作、スクロール等

### テストファイル配置

```
front/tests/
└── e2e/
    ├── helpers/
    │   ├── test-data.ts           # テストデータ管理ヘルパー
    │   ├── long-answer.ts         # 長い応答を生成中にする（停止・再生成の検証用）
    │   ├── model.ts               # E2E のモデル解決（E2E_OLLAMA_MODEL・軽量モデル判定）
    │   ├── local-files.ts         # E2E の LOCAL_FILE_ROOTS（fixtures/local-files のフォルダ。#148）
    │   └── global-setup.ts        # 開始前に dev サーバーのモデル・モデル取得済み・PlantUML サーバーへの接続を検証
    ├── chat.spec.ts               # チャット機能テスト
    ├── chat-streaming.spec.ts     # ストリーミング表示テスト
    ├── chat-loading.spec.ts       # ローディング表示テスト
    ├── copy.spec.ts               # 応答・コードブロックのコピーと結果表示テスト
    ├── diagram.spec.ts            # Mermaid・PlantUML の図（img での表示・複数・テーマ追従・生成後の描画・構文の誤り・空・XSS の非実行・SANDBOX・API の失敗）、拡大・保存・ソースとの切り替え
    ├── export.spec.ts             # 応答・会話の書き出し（Markdown で保存・会話全体の Markdown / JSON・押せない条件・ファイル名）
    ├── image-attachment.spec.ts   # 画像添付（ファイル選択・D&D・貼り付け・縮小・プレビューと削除・枚数と形式・非対応モデルの案内・保存済みの画像の表示と拡大・送信と復元）
    ├── syntax-highlight.spec.ts   # コードブロックのシンタックスハイライト・言語名ラベル・テーマ追従テスト
    ├── system-prompt.spec.ts      # 会話の役割（保存・送信への付与・役割なし・取り消し・エージェントでの連結・保存失敗）テスト
    ├── streaming-stop.spec.ts     # 生成の停止（Stop ボタン・Escape・中断した応答の保存）テスト
    ├── regenerate.spec.ts         # 応答の再生成（置き換え・旧応答への復元・保存失敗）テスト
    ├── conversation-switch.spec.ts # 生成中の会話の切り替え（応答が届き続ける・切り替え先の操作・サイドバーの印・削除で停止・裏のエラー）
    ├── search.spec.ts             # 会話検索（本文での一致と強調・AND・0 件・× と Escape・さらに表示・検索の失敗）
    ├── sidebar.spec.ts            # サイドバー操作テスト・表示の切り替え（#24）
    ├── conversation.spec.ts       # 会話管理テスト
    ├── security.spec.ts           # セキュリティテスト
    ├── responsive.spec.ts         # レスポンシブテスト
    ├── mobile-navigation.spec.ts  # モバイルのドロワーから会話管理・設定へ到達できるか
    ├── theme.spec.ts              # テーマ切替・localStorage永続化テスト
    ├── settings-modal.spec.ts     # 設定モーダルの開閉（Close・×・Escape・背景のクリック・フォーカスの戻り先・閉じ込め）
    ├── agent.spec.ts              # エージェント基盤テスト（Phase A）
    ├── agent-phase-b.spec.ts      # 調査系ツールテスト（Phase B）
    ├── agent-phase-c.spec.ts      # 自律エージェントテスト（Phase C）
    ├── agent-metadata.spec.ts     # エージェント応答の付随情報（思考過程・統計）の復元
    ├── agent-timeline.spec.ts     # エージェントの応答を説明 → ツールの結果 → 回答の順に並べる表示（古いデータ・回答前の停止）
    ├── tool-result-summary.spec.ts # ツールの結果パネルの見出し（件数・0 件・失敗の理由）
    ├── local-files.spec.ts        # ローカルのファイルのツール（一覧への登録・保存済みの結果の表示・止めた外部のツール・実際に読ませる（大モデルのみ））
    ├── file-write-approval.spec.ts # ファイルの書き込みの承認（承認カードの差分・許可で書く・拒否で書かない（大モデルのみ）・承認の API の 404 / 400）
    ├── command-approval.spec.ts # コマンドの実行の承認（一覧への登録・承認カードのコマンドと作業フォルダ・許可で実行・拒否で実行しない・失敗の終了コード（大モデルのみ））
    ├── github-tools.spec.ts       # GitHub のツール（一覧への登録・偽の gh で PR の一覧・コメントの承認カードと拒否・gh のエラー（大モデルのみ））
    ├── token-metrics.spec.ts      # 応答のトークン数・生成速度（要約と内訳の開閉・エージェントの内訳・値の無い応答・形の合わない値・実際の生成（CI はスキップ））
    ├── prompt-templates.spec.ts   # プロンプトテンプレート（`/` の候補・Enter / Tab / クリックで入れる・絞り込み・管理画面の作成 / 編集 / 2 段階の削除・例を追加・一致しないときの送信・途中の `/`・Escape で生成を止めない・重複・一覧の取得と保存の失敗）
    ├── bookmarks.spec.ts          # 応答のブックマーク（ボタンで付け外し・読み直しても残る・一覧の並びと検索の強調・メモ・別の会話の応答へ移る・2 段階で外す・保存に失敗した応答（CI はスキップ）・付ける / 一覧の API の失敗）
    ├── browser-tools.spec.ts      # ブラウザのツール（一覧への登録・確認用のページの合言葉を読む・ボタンを押す前の承認カードの許可と拒否・許可していない手元のサーバー・名前を引けないホスト（大モデルのみ））
    └── screenshot.spec.ts         # スクリーンショットテスト
```

### CI（GitHub Actions）

- `push` to main / `pull_request` to main で自動実行
- **ドキュメントのみの変更（`docs/**`・`manuals/**`・`**.md`・`.claude/**`・`LICENSE`）では Quality / UT / IT / E2E の 4 本とも発火しない**（`paths-ignore`）。コードとドキュメントが混在する変更では通常どおり実行される。詳細は `.claude/rules/testing.md`「CI の発火条件」を参照
- **Workflow Lint**（`workflow-lint.yml`）は常時実行し、actionlint（shellcheck 込み）でワークフローを検査するとともに、上記 4 本の `on:` が一致していることを検査する
- **Secret scan**（`secret-scan.yml`）は常時実行し、鍵・`.env` 系の秘匿ファイルが Git の追跡対象に入っていないことを検査する（`.example` 等のテンプレートと `env.d.ts` は除外）
- ワークフローは最小権限の `permissions` と `concurrency`（PR のときだけ古い実行をキャンセル）を必ず置く。規約は `.claude/rules/github-actions.md` を参照
- `uses:` のアクションの版は **Dependabot**（`.github/dependabot.yml`、週次）が更新する。手で一括置換せず、Dependabot の PR をリリースノートで確認してマージする
- CI環境: Ubuntu + PostgreSQL (service container) + Ollama (`qwen2.5:0.5b`)
- CIではストリーミング完了テスト・スクリーンショットテストをスキップ
- 詳細は `docs/08-ci-e2e-bug-report.md` を参照

## コード品質

- **ESLint** + **Prettier** を導入する
- **JSDoc（TSDoc）規約を `eslint-plugin-jsdoc` で機械強制**する（`front/eslint.config.mjs`）。型ブレース禁止・`@param`/`@returns` の整合を `pnpm lint` で検出。規約は `.claude/rules/jsdoc.md` を参照
- **TypeScript 固有規約**（type/interface の使い分け・型/定数の配置・`any` 禁止・`enum` 回避・`import type`・`as`/`!` 抑制）は `.claude/rules/typescript.md` を参照
- **`import type` を `@typescript-eslint/consistent-type-imports` で機械強制**する（`fixStyle: separate-type-imports`）。`tsconfig.json` の `verbatimModuleSyntax: true` と併せて、型 import が実行時に残らないことを保証する
- 保存時の自動フォーマットを推奨
- **CI の `quality` ジョブで `lint` / `format:check` / `typecheck` を機械強制**する（ローカル実行に依存しない）
- **整形コミットは機能変更と分離**し、`.git-blame-ignore-revs` に登録する
- リント・フォーマットコマンド:
  - `pnpm lint` — ESLintチェック
  - `pnpm format` — Prettierフォーマット（`front/` 配下全体）
  - `pnpm format:check` — Prettier 差分チェック（書き換えない）
  - `pnpm typecheck` — `tsc --noEmit` による型チェック

## 技術規約

- パッケージマネージャー: **pnpm**
- フレームワーク: **Next.js App Router**
- 言語: **TypeScript**（strict mode）
- スタイリング: **TailwindCSS**
- テストFW: **Playwright**（E2Eテスト）
- LLM通信: **Next.js Route Handlers**経由（フロントエンドから直接Ollamaを叩かない）
