# アーキテクチャ設計書

> 最終更新: 2026-10-31

## 目次

- [システム構成](#システム構成)
- [ディレクトリ構成](#ディレクトリ構成)
  - [プロジェクト全体](#プロジェクト全体)
  - [front/src/ 内部構成](#frontsrc-内部構成)
  - [front/prisma/](#frontprisma)
  - [front/tests/](#fronttests)
  - [ディレクトリ方針](#ディレクトリ方針)
- [データベース設計](#データベース設計)
  - [ERD](#erd)
  - [Prismaスキーマ](#prismaスキーマ)
- [データフロー](#データフロー)
  - [チャット送信フロー](#チャット送信フロー)
  - [会話管理フロー](#会話管理フロー)
  - [ストリーミング実装方針](#ストリーミング実装方針)
- [環境変数](#環境変数)
- [状態管理](#状態管理)
- [テーマシステム](#テーマシステム)
  - [テーマ一覧](#テーマ一覧)
  - [注意事項](#注意事項)

## システム構成

図（draw.io）は [`diagrams/`](./diagrams/README.md) にある。全体アーキテクチャのほか、Ollama とアプリの責務の分担（パターン表・シーケンス図）も描いている。

![全体アーキテクチャ](./diagrams/01-architecture.png)

```
ブラウザ (Next.js Frontend)
    ↓ fetch (streaming)
Next.js Route Handlers (API層)
    ├──→ Prisma ORM ──→ PostgreSQL (Docker)
    ├──→ HTTP POST (streaming) ──→ Ollama API (localhost:11434) ──→ qwen3.8:27b
    ├──→ web_search ツール ──→ SearXNG (Docker・127.0.0.1:8888) ──→ Google / DuckDuckGo / Brave …
    ├──→ GitHub のツール ──→ gh (GitHub CLI。アプリが組み立てた引数) ──→ GitHub（GITHUB_REPOS のリポジトリだけ）
    ├──→ ブラウザのツール ──→ Chromium（ヘッドレス）──→ アプリの中のプロキシ（宛先を判定）──→ 公開の Web / BROWSER_LOCAL_ORIGINS の開発サーバー
    └──→ /api/diagrams/plantuml ──→ PlantUML サーバー (Docker・127.0.0.1:8889。SANDBOX)
```

- フロントエンドからOllamaへ直接通信しない。Route Handlersを経由する。
- 会話履歴はPostgreSQLに永続化し、Prisma ORMで操作する。添付画像もメッセージに紐づけて PostgreSQL（`bytea`）に置き、`/api/chat` は画像を ID で受けて DB から読み、Ollama へ渡す（#6。`docs/13-image-attachment.md`）。
- Ollama接続先はローカルのみ想定（`localhost:11434`）。
- Web検索は、ローカルの SearXNG（メタ検索エンジン）の JSON API を経由する。SearXNG が複数の検索エンジンに問い合わせるため、1 つがブロックされても結果を返せる（#151）。
- GitHub のツール（#148 Phase C）は、利用者の `gh`（`gh auth login` 済み）をシェルを介さずに起動する。引数はアプリが組み立て、モデルは `gh` の引数を書けない。コメント・PR の作成は実行前に承認を挟む（`docs/17-github-tools.md`）。
- 図は、Mermaid はブラウザの中で描き、PlantUML は Route Handler 経由でローカルの PlantUML サーバーに描かせる（#169・#171）。どちらも SVG を data: URI の `<img>` で表示する。PlantUML サーバーは外部の URL・ファイルの読み込みを止めた設定（`PLANTUML_SECURITY_PROFILE=SANDBOX`）で動かす。

## ディレクトリ構成

> **重要**: `base/` は読み取り専用（編集禁止）。開発コードは全て `front/` 内に配置する。

### プロジェクト全体

```
local-ai-chat-web-app/
├── .github/
│   ├── dependabot.yml         # Dependabot（GitHub Actions の版更新・週次）
│   └── workflows/             # GitHub Actions（規約は .claude/rules/github-actions.md）
│       ├── quality.yml        #   lint / format:check / typecheck
│       ├── unit-test.yml      #   UT
│       ├── integration-test.yml # IT（Testcontainers）
│       ├── e2e-test.yml       #   E2E（Ollama + PostgreSQL）
│       ├── workflow-lint.yml  #   actionlint・トリガー定義の一致検査（常時実行）
│       └── secret-scan.yml    #   鍵・.env の追跡を検出（常時実行）
├── base/                      # UIデザインリファレンス（読み取り専用・編集禁止）
├── docs/                      # プロジェクトドキュメント
│   └── diagrams/              #   draw.io の構成図（architecture.drawio と各ページの PNG）
├── manuals/                   # セットアップガイド等のマニュアル
│   └── setup-guide-macos.md   #   macOS向けセットアップ手順書
├── front/                     # Next.jsアプリケーション本体（開発はここで行う）
│   ├── src/                   #   ソースコード
│   ├── prisma/                #   Prismaスキーマ・マイグレーション
│   ├── tests/                 #   テスト
│   ├── public/                #   静的ファイル
│   ├── .env.local             #   環境変数
│   ├── next.config.ts         #   Next.js設定（reactCompiler / CSPヘッダー）
│   ├── postcss.config.mjs     #   PostCSS設定（TailwindCSS 4。tailwind.config は不使用）
│   ├── tsconfig.json          #   TypeScript設定
│   ├── playwright.config.ts   #   Playwright設定
│   ├── package.json
│   └── pnpm-lock.yaml
├── docker-compose.yml         # PostgreSQL・SearXNG・PlantUML のコンテナ定義
├── searxng/settings.yml       # SearXNG の設定（JSON API の有効化・Web 検索のエンジンの追加等）
├── CLAUDE.md
└── README.md
```

### front/src/ 内部構成

```
front/src/
├── app/                       # Next.js App Router
│   ├── globals.css            #   グローバルCSS（テーマ変数定義含む）
│   ├── layout.tsx             #   ルートレイアウト
│   ├── page.tsx               #   トップページ（チャット画面・状態管理の中心）
│   └── api/                   #   Route Handlers
│       ├── agent/approvals/[id]/
│       │   └── route.ts       #     ツールの実行前の承認に許可・拒否を渡す（#148 Phase A2）
│       ├── attachments/[id]/
│       │   └── route.ts       #     添付画像の取得（#6）
│       ├── bookmarks/
│       │   ├── route.ts       #     応答のブックマークの一覧（新しい順・キーワード検索・20 件ずつ）・付ける（#30）
│       │   └── [id]/
│       │       └── route.ts   #     メモの書き換え（PATCH）・外す
│       ├── chat/
│       │   └── route.ts       #     Ollama通信（通常 / エージェント、model指定可。添付画像は ID で受ける）
│       ├── diagrams/plantuml/
│       │   └── route.ts       #     PlantUML の図の描画（PlantUML サーバーへ中継。#171）
│       ├── models/
│       │   └── route.ts       #     利用可能モデル一覧取得
│       ├── prompt-templates/
│       │   ├── route.ts       #     プロンプトテンプレートの一覧（ショートカットの昇順）・作成（#28）
│       │   ├── [id]/
│       │   │   └── route.ts   #     テンプレートの置き換え（PUT）・削除
│       │   └── examples/
│       │       └── route.ts   #     一覧が空のときに例の 3 件を作る
│       ├── tools/
│       │   └── route.ts       #     エージェントの利用可能ツール一覧取得
│       └── conversations/
│           ├── route.ts       #     会話一覧取得・新規作成（分岐元の forkedFrom 付き。#29）
│           ├── search/
│           │   └── route.ts   #     会話のキーワード検索（#11）
│           └── [id]/
│               ├── route.ts   #     会話の役割の変更（PATCH）・会話削除
│               ├── fork/
│               │   └── route.ts #   応答から会話を分岐する（その応答までを新しい会話にコピー。#29）
│               ├── generate-title/
│               │   └── route.ts #   LLMで会話タイトル自動生成
│               └── messages/
│                   ├── route.ts #   メッセージ取得（付いているブックマークの ID 付き。#30）・保存
│                   └── [messageId]/
│                       └── route.ts # 応答の置き換え（再生成。旧応答のブックマークは消す）
├── components/                # UIコンポーネント（Atomic Design。#163）
│   ├── common/                #   共通の部品（ドメインを知らない）
│   │   ├── atoms/             #     Button・IconButton・ToggleChip・Switch・TextInput・TextArea・Select・Mark・StatusDot・LoadingDots
│   │   ├── molecules/         #     Modal（ネイティブの <dialog> の外枠。幅は md / wide）・SearchBox（検索欄）・CopyButton（コピーと結果の一時表示）・CodeBlockFrame（コードブロックの枠と見出し行）・HighlightedText（一致した片の強調。#30）
│   │   └── templates/
│   │       └── ChatLayout.tsx #     画面の枠（サイドバー・ドロワー・ヘッダー・本文・お知らせ・入力欄・フッター）。中身は props で受け取る
│   └── features/              #   機能の部品
│       ├── chat/
│       │   ├── atoms/
│       │   │   ├── AttachButton.tsx      # 画像を添付するクリップのボタン（隠したファイル選択を開く。#6）
│       │   │   └── ElementBoxOverlay.tsx # スクリーンショットに、操作する要素を囲む枠を重ねる（SVG。#200）
│       │   ├── molecules/
│       │   │   ├── ApprovalCard.tsx      # ツールの実行前の承認カード（ファイルの差分・コマンドと作業フォルダ・GitHub の送る本文・ブラウザの操作のページと要素と操作の前の画面・許可 / 拒否。#148 Phase A2・B・C、#149 Phase C、#200）
│       │   │   ├── AttachmentPreview.tsx # 送信前の添付画像のサムネイル・削除・準備中・添付できなかった理由・非対応モデルの案内（#6）
│       │   │   ├── MessageImages.tsx     # メッセージの中の添付画像のサムネイル（押すと拡大。#6）
│       │   │   ├── ImageZoomDialog.tsx   # 添付画像・スクリーンショットの拡大のダイアログ（要素の枠も重ねる。#6・#200）
│       │   │   ├── ToolScreenshots.tsx   # ブラウザのツールが撮った画面を並べる（操作の前は要素の枠付き・押すと拡大。#200）
│       │   │   ├── ResponseMetrics.tsx   # 応答のトークン数・生成の速さの要約と、押して開く内訳（#31）
│       │   │   ├── PromptTemplateSuggestions.tsx # 入力欄の上に重ねるプロンプトテンプレートの候補（例を追加・管理の入口。#28）
│       │   │   ├── ToolCallIndicator.tsx # ツール実行中インジケーター
│       │   │   ├── WebSearchResult.tsx   # web_search の結果をリンク付きの一覧に整形
│       │   │   ├── DiagramView.tsx       # 描画の状態に応じて図（data: URI の img）かソースとエラーを表示。ソースとの切り替え・拡大のボタン（#169・#171・#176）
│       │   │   └── DiagramZoomDialog.tsx # 図の拡大（倍率の変更）と SVG / PNG での保存のダイアログ（#176）
│       │   └── organisms/
│       │       ├── ChatBar.tsx    # メッセージ入力（IME対応・画像の添付ボタン / ドラッグ＆ドロップ / 貼り付け・先頭の `/` でテンプレートの候補とキー操作。#28）
│       │       ├── ChatWindow.tsx # メッセージ一覧表示（応答のブックマークのボタン・ブックマークから移る先へのスクロールと枠。#30。応答の下の「ここから分岐」のボタン。#29）
│       │       ├── Footer.tsx     # フッター
│       │       ├── Header.tsx     # ヘッダー（サイドバーの切り替え・会話の役割の表示と編集の入口・モデル選択ドロップダウン）
│       │       ├── RoleDialog.tsx # 会話の役割（システムプロンプト）の編集ダイアログ（プリセット・自由入力）
│       │       ├── ExportDialog.tsx # 会話全体の書き出しの形式（Markdown・JSON）を選ぶダイアログ（#12）
│       │       ├── MarkdownContent.tsx # Markdown整形表示（コードブロックのシンタックスハイライト・言語名・コピーボタン付き。mermaid は図）
│       │       ├── AgentThinking.tsx   # エージェント思考過程の表示（<think> タグ / message.thinking 対応）
│       │       ├── AgentSteps.tsx      # エージェントの応答の回答より前の流れ（説明 → ツールの結果）を呼んだ順に並べる（#186）
│       │       └── ToolCallResult.tsx  # ツール実行結果の折りたたみ表示
│       ├── sidebar/
│       │   ├── molecules/
│       │   │   ├── ConversationListItem.tsx # 履歴の 1 行（生成中の印・削除ボタン）
│       │   │   └── SearchResultItem.tsx     # 検索結果の 1 件（タイトル・抜粋の強調）
│       │   └── organisms/
│       │       ├── Sidebar.tsx    # デスクトップのサイドバー（md 以上。隠すと幅 0・inert。#24）
│       │       ├── SidebarDrawer.tsx # モバイルのサイドバードロワー（md 未満）
│       │       ├── SidebarContent.tsx # サイドバーの中身（会話一覧、新規会話、ブックマーク・設定のボタン）。上記 2 つが共有
│       │       └── ConversationSearch.tsx # 会話の検索欄と検索結果
│       ├── prompt-template/
│       │   └── organisms/
│       │       └── PromptTemplateDialog.tsx # プロンプトテンプレートの一覧・作成・編集・削除（2 段階）のダイアログ（#28）
│       ├── bookmark/
│       │   ├── molecules/
│       │   │   └── BookmarkListItem.tsx # ブックマークの 1 件（タイトル・抜粋・メモの強調・メモの編集・2 段階の外す。#30）
│       │   └── organisms/
│       │       └── BookmarkDialog.tsx # ブックマークの一覧のダイアログ（検索・さらに表示・押すと元の応答へ移る。#30）
│       ├── shortcut/
│       │   └── organisms/
│       │       └── ShortcutHelpDialog.tsx # ショートカットの一覧のダイアログ（定義から作り、開いている端末の表記で <kbd> に出す。#33）
│       └── settings/
│           └── organisms/
│               └── SettingsModal.tsx # 設定モーダル（モデル選択・ツール・エージェントのプリセット・テンプレートの管理とショートカットの一覧の入口・テーマ切替）
├── constants/                 # 定数（機能ごとのディレクトリ）
│   ├── agent/
│   │   ├── approval.ts        #     承認の待ち時間の上限（5 分。エージェントループと承認待ちで共有。#202）
│   │   └── github.ts          #     GitHub のツールで共通の引数の定義（kind・number）・一覧の件数の上限（#148 Phase C）
│   ├── chat/
│   │   ├── toolLabels.ts      #     ツール名→表示ラベルのマッピング
│   │   └── imageAttachment.ts #     添付を受け付ける画像の形式（#6）
│   ├── conversation/
│   │   └── title.ts           #     タイトル未指定のときの会話タイトル（会話の作成と分岐のタイトルで共有。#29）
│   ├── shortcut/
│   │   └── shortcuts.ts       #     ページ全体のショートカットの定義（判定とヘルプで共有。#33）
│   ├── sidebar/
│   │   ├── list.ts            #     一覧の行の目印の属性（↑↓ で移る行。#33）
│   │   └── layout.ts          #     デスクトップの幅のメディアクエリ（ドロワーとショートカットで共有。#33）
│   └── prompt-template/
│       └── errors.ts          #     ショートカットの重複のエラーメッセージ（作成・置き換えの route で共有。#28）
├── generated/
│   └── prisma/                #   Prisma自動生成クライアント（出力先カスタマイズ）
├── hooks/                     # カスタムフック（機能ごとのディレクトリ）
│   ├── chat/
│   │   ├── useChat.ts         #     チャットロジック（ストリーミング、NDJSON、タイトル生成、会話ごとの状態）
│   │   ├── useModels.ts       #     利用可能なモデル一覧（画像に対応したモデルを含む）の取得と選択中のモデル
│   │   ├── useImageAttachments.ts # 送信前の添付画像（追加・前処理・削除・添付できなかった理由。#6）
│   │   ├── useApprovalCountdown.ts # 承認カードの残り時間を 1 秒ごとに数え直す（#202）
│   │   ├── useConversationFork.ts # 応答から会話を分岐する（返事を待つ間の二度押しの防止・失敗を分岐元の会話に結びつけて持つ。#29）
│   │   ├── useMermaidDiagram.ts #   mermaid の読み込み・テーマの色での描画・テーマ切替での描き直し（#169）
│   │   └── usePlantUmlDiagram.ts #  /api/diagrams/plantuml で PlantUML の図を描かせる（#171）
│   ├── clipboard/
│   │   └── useCopyFeedback.ts #     コピーの実行と結果表示（copied / failed）の自動リセット
│   ├── prompt-template/
│   │   └── usePromptTemplates.ts #  プロンプトテンプレートの一覧の読み込み・作成・置き換え・削除・例の追加（変更の後は読み直す。#28）
│   ├── bookmark/
│   │   ├── useBookmarks.ts    #     ブックマークの一覧の読み込み・検索（入力の待ち合わせ・前の要求の中断）・さらに表示・メモ・外す（#30）
│   │   └── useMessageBookmark.ts #  応答の下のボタンで付ける・外す（返事を待つ間の表示・失敗で戻す。#30）
│   ├── settings/
│   │   └── useAgentSettings.ts #    ツール使用の有効状態・エージェントのプリセット（localStorage永続化）
│   ├── shortcut/
│   │   ├── useKeyboardShortcuts.ts # ページ全体のショートカットを受け、操作ごとの関数を呼ぶ（モーダル・ドロワー・IME の間は受けない。#33）
│   │   └── useIsMac.ts        #     開いている端末が Mac か（⌘ と Ctrl の出し分け。#33）
│   ├── sidebar/
│   │   ├── useConversations.ts #    会話CRUD管理
│   │   ├── useConversationSearch.ts # 会話検索（入力の待ち合わせ・前の要求の中断・さらに表示）
│   │   ├── useDrawerDialog.ts #     ドロワーのフォーカス管理・Escape・スクロール固定
│   │   ├── useListNavigation.ts #   一覧（会話の履歴・検索の結果）の行を ↑↓・Home・End で移る（#33）
│   │   └── useSidebarVisibility.ts # デスクトップのサイドバーの表示・非表示と localStorage への保存（#24）
│   └── theme/
│       └── useTheme.ts        #     テーマ切替フック（localStorage永続化）
├── lib/                       # ユーティリティ・外部連携（機能ごとのディレクトリ）
│   ├── agent/                 #   エージェント
│   │   ├── agent.ts           #     エージェントループ（ツール呼び出し制御・最大ラウンド到達時の最終回答）
│   │   ├── agent-config.ts    #     エージェント設定の環境変数の検証（範囲外は既定値へ戻す）
│   │   ├── agent-prompts.ts   #     エージェントモードのシステムプロンプトプリセット定義
│   │   ├── approvals.ts       #     ツールの実行前の承認待ち（globalThis の Map・5 分で時間切れ・停止で取り消し。#148 Phase A2）
│   │   └── tools/             #     ツール実装
│   │       ├── types.ts       #       ツール関連型定義
│   │       ├── index.ts       #       ツールレジストリ（register/get/execute）
│   │       ├── output.ts      #       ツールの実行結果の組み立て（失敗の toolError・接続先ごと使えない失敗の toolUnavailable・承認を経ない呼び出しの toolNeedsApproval）
│   │       ├── registry.ts    #       ツール登録の初期化（initializeTools）
│   │       ├── get-current-datetime.ts # 現在日時取得ツール
│   │       ├── calculate.ts   #       数式計算ツール
│   │       ├── web-search.ts  #       Web検索ツール（SearXNG）
│   │       ├── url-fetch.ts   #       URL取得ツール（SSRF防止）
│   │       ├── network-guard.ts #     プライベート・ループバックのアドレスの判定と名前の解決（url_fetch とブラウザのツールで共有。#149）
│   │       ├── read-body.ts   #       本文のバイト上限付きストリーム読み取り（外部取得の共通処理）
│   │       ├── browser/       #       ブラウザのツール（#149。BROWSER_ENABLED=true のときだけ登録）
│   │       │   ├── config.ts  #         BROWSER_ENABLED・BROWSER_LOCAL_ORIGINS の解釈
│   │       │   ├── url-policy.ts #      開く URL の読み取り・宛先の判定（アプリ自身・許可した開発サーバー・プライベート・手元を読んだ後）
│   │       │   ├── proxy.ts   #         宛先を判定して中継する HTTP プロキシ（http・CONNECT。判定したアドレスへ接続）
│   │       │   ├── browser.ts #         Chromium の起動・使い回し・同時のセッションの上限・放置で閉じる（globalThis）
│   │       │   ├── session.ts #         応答ごとのコンテキストとページ・後始末・閉じたダイアログと開いた新しいウィンドウの記録・新しいウィンドウへの切り替え（#200）・通信が落ち着くのを待つ
│   │       │   ├── snapshot.ts #        スナップショットの取得・上限での切り詰め・結果の文章
│   │       │   ├── navigate.ts / read-snapshot.ts / screenshot.ts # browser_navigate・browser_snapshot・browser_screenshot
│   │       │   ├── element.ts #         参照の形・スナップショットから参照の行を探す・要素の役割と名前（#149 Phase C）
│   │       │   ├── action.ts  #         操作のツールに共通の準備（承認カード）と実行（照合・操作・操作の後のページ）
│   │       │   ├── capture.ts #         利用者へ見せる画面を撮る（JPEG・要素の位置・応答ごとの枚数の上限。#200）
│   │       │   └── click.ts / type.ts / select.ts # browser_click・browser_type・browser_select（実行前に承認）
│   │       ├── github/        #       GitHub のツール（#148 Phase C。GITHUB_REPOS があるときだけ登録）
│   │       │   ├── config.ts  #         GITHUB_REPOS の解釈（owner/name の形・大文字小文字の重なり）
│   │       │   ├── args.ts    #         引数の定義と検証（repo・kind・number・state・limit・ブランチ名・本文）
│   │       │   ├── gh.ts      #         gh の実行（一時フォルダ・絞った環境変数・終了コード）・JSON の読み取り・リポジトリの情報
│   │       │   ├── format.ts  #         gh の JSON・差分 → モデルへ返す文章と要約（上限・差分の絞り込み）
│   │       │   ├── list.ts / view.ts / pr-diff.ts #  github_list・github_view・github_pr_diff（承認なし）
│   │       │   └── comment.ts / create-pr.ts #       github_comment・github_create_pr（承認が要る）
│   │       ├── local-commands/ #      コマンドの実行のツール（#148 Phase B。LOCAL_COMMANDS と LOCAL_FILE_WRITE_ROOTS があるときだけ登録）
│   │       │   ├── config.ts  #         LOCAL_COMMANDS（シェル等を外す）・LOCAL_COMMAND_TIMEOUT_MS の解釈
│   │       │   ├── parse.ts   #         文字列 → 引数の配列（クォート・シェルの記号を断る）・クォートし直し
│   │       │   ├── resolve.ts #         PATH から実行ファイルを探す・作業フォルダの判定
│   │       │   ├── process.ts #         シェルを介さない実行・環境変数の絞り込み・プロセスグループごとの停止・出力の先頭と末尾
│   │       │   └── run-command.ts #     run_command（承認が要る）と結果の文章
│   │       └── local-files/   #       ローカルのファイルのツール（#148。LOCAL_FILE_ROOTS があるときだけ登録）
│   │           ├── config.ts  #         LOCAL_FILE_ROOTS の解釈（~・realpath・不正値の警告）
│   │           ├── path-guard.ts #      パスの判定（実体のパスでの包含・秘匿ファイル・たどらないフォルダ）
│   │           ├── text.ts    #         バイナリの判定・行の切り出し・ワイルドカード
│   │           ├── list-directory.ts #  フォルダの直下の一覧
│   │           ├── search-files.ts #    ファイル名・中身の検索
│   │           ├── read-file.ts #       行番号付きの読み取り
│   │           ├── write-guard.ts #     書き込み先の判定（新規は親のフォルダ・.git・秘匿）と既存の中身のハッシュ（#148 Phase A2）
│   │           ├── diff.ts    #         承認で見せる差分（jsdiff）と見出し
│   │           ├── write-file.ts #      ファイルの作成・上書き（承認が要る）
│   │           └── edit-file.ts #       1 か所だけ一致する文字列の置き換え（承認が要る・CRLF）
│   ├── llm/                   #   LLM（Ollama）との通信
│   │   ├── ollama.ts          #     Ollamaクライアント（streamChat / chatOnce / listModels / getDefaultModel。接続先・モデル解決の唯一の窓口）
│   │   ├── current-date.ts    #     システムプロンプトの後ろに足す「現在の日時」の節（#154）
│   │   └── metrics.ts         #     Ollama の終わりのチャンクからトークン数・所要時間を集める・ラウンドの合計（#31）
│   ├── chat/                  #   チャット（チャットの部品・useChat から使う）
│   │   ├── chat-state.ts      #     会話ごとのチャット状態の更新（切り替え・読み込み・不要な状態の破棄。#147。ブックマークの反映。#30）
│   │   ├── conversation-history.ts # 表示中のメッセージから /api/chat へ渡す会話履歴を組み立てる（上限内に収める）
│   │   ├── message-metadata.ts #    メッセージ metadata の組み立て・取得時の実行時検証
│   │   ├── regenerate.ts      #     再生成できる応答の判定と、送り直す質問・履歴の組み立て
│   │   ├── agent-timeline.ts  #     エージェントの応答を本文の位置（contentOffset）で区切り、説明 → ツール → 回答に並べる（#186）
│   │   ├── tool-call-progress.ts #  結果が届く前のツールの記録の状態（実行中・承認待ち）の更新（#192）
│   │   ├── approval-countdown.ts #  承認カードの残り時間（受け取った待ち時間からの期限・切り上げ・警告・時間切れ。#202）
│   │   ├── response-metrics.ts #    応答のトークン数の表示の文字列（要約・内訳・速さ。#31）
│   │   ├── tool-screenshots.ts #    ツールの画面の表示の URL・保存する記録から中身を外す・保存の添付にする・done の記録に中身を戻す（#200）
│   │   ├── system-prompt.ts   #     会話の役割のプリセット・表示名の逆引き・役割とエージェントのプリセットの連結
│   │   ├── code-block.ts      #     コードブロックの構文木から言語名・コピーする本文を取り出す
│   │   ├── diagram.ts         #     Mermaid の判定・要素 ID・SVG の data: URI と大きさ・テーマの色の組み立て（#169）
│   │   ├── image-attachment.ts #    添付画像の選別（形式・大きさ・枚数）とブラウザでの縮小・再エンコード（#6）
│   │   └── export.ts          #     応答・会話の書き出し（ファイル名・Markdown / JSON の中身。#12）
│   ├── conversation/          #   会話
│   │   ├── search.ts          #     会話検索のキーワードの解釈（ブックマークの一覧と共有。#30）・抜粋の切り出し・強調の分割・LIKE のエスケープ（#11）
│   │   └── fork.ts            #     分岐した会話のタイトル・コピーした応答の metadata のツールの画面の ID の書き換え（#29）
│   ├── bookmark/              #   ブックマーク
│   │   └── snippet.ts         #     一覧に出す応答の抜粋（一致した箇所の前後か先頭の 120 文字。#30）
│   ├── prompt-template/       #   プロンプトテンプレート
│   │   └── suggest.ts         #     入力欄の `/` の候補を出す条件・絞り込み・選択の移動（#28）
│   ├── shortcut/              #   ショートカット
│   │   └── match.ts           #     キーの判定（修飾キーのちょうど一致・効かせない場面）・端末の表記（#33）
│   ├── sidebar/               #   サイドバー
│   │   ├── visibility.ts      #     サイドバーの表示状態の保存値の解釈（#24）
│   │   └── list-navigation.ts #     一覧の移る先（↑↓・Home・End・前後の会話。端で止まる。#33）
│   ├── server/                #   サーバー専用（app/api/** から使う）
│   │   ├── prisma.ts          #     Prismaクライアントインスタンス
│   │   ├── request-body.ts    #     Route Handler の JSON ボディの実行時検証（parseChatBody 等）
│   │   ├── conversation.ts    #     会話を返す API（一覧・作成・役割の変更・分岐）の共通の select と応答の形（分岐元の forkedFrom。#29）
│   │   ├── plantuml.ts        #     PlantUML サーバーとの通信（POST /svg・エラーの解釈。#171）
│   │   ├── attachment.ts      #     添付画像の形式の判定（マジックナンバー）・Base64 の復号（#6）
│   │   ├── chat-images.ts     #     /api/chat で LLM へ渡す画像の選び方・省略の注記（#6）
│   │   └── prisma-error.ts    #     Prisma の一意制約の違反（409。メッセージの id・テンプレートのショートカット・ブックマーク。#28・#30）と外部キーの違反（404。ブックマーク・分岐。#30・#29）の判定
│   └── shared/                #   サーバー・クライアント共通
│       ├── validation.ts      #     入力の上限値・UUID・テンプレートのショートカットの形の検証（フロントと API が同じ定数を使う）
│       ├── class-names.ts     #     条件付きのクラス名の連結（cn。UI の atoms が使う）
│       ├── clipboard.ts       #     クリップボードへのコピー（Clipboard API → execCommand の代わりのコピー）
│       ├── download.ts        #     Blob・文字列をファイルとして保存させる（<a download>）
│       └── image.ts           #     SVG の画像を <canvas> で PNG にする（図の保存。#176）
└── types/                     # 機能をまたぐ共通型（機能ごとのディレクトリ）
    ├── agent/
    │   └── tool-call.ts       #     ToolCallInfo（ツール呼び出しの記録）
    ├── chat/
    │   ├── message.ts         #     Message・MessageImage・MessageSaveState・HistoryEntry
    │   ├── attachment.ts      #     PreparedImage（送信前の添付画像。#6）
    │   ├── agent-timeline.ts  #     AgentTimeline・AgentTimelineStep（エージェントの応答の時系列。#186）
    │   ├── metrics.ts         #     ResponseMetrics（応答のトークン数・所要時間。#31）
    │   └── diagram.ts         #     DiagramKind・DiagramState（図の種類と描画の状態）
    ├── conversation/
    │   └── conversation.ts    #     Conversation・ConversationForkSource（分岐元。#29）・ConversationSearchResult
    ├── prompt-template/
    │   └── prompt-template.ts #     PromptTemplate（#28）
    ├── bookmark/
    │   └── bookmark.ts        #     Bookmark・BookmarkListItem（ブックマークと一覧の 1 件。#30）
    ├── shortcut/
    │   └── shortcut.ts        #     ShortcutId・ShortcutBinding・ShortcutDefinition（#33）
    └── theme/
        └── theme.ts           #     テーマ定義（THEMES を as const、ThemeId/ThemeOption を導出）
```

### front/prisma/

```
front/prisma/
├── schema.prisma              # スキーマ定義
└── migrations/                # マイグレーション履歴
```

### front/tests/

```
front/tests/
└── e2e/
    ├── helpers/
    │   ├── test-data.ts           # テストデータ管理ヘルパー（CRUD・入力支援）
    │   ├── long-answer.ts         # 長い応答を生成中にする（停止・再生成の検証用）
    │   ├── model.ts               # E2E のモデル解決（E2E_OLLAMA_MODEL・軽量モデル判定）
    │   ├── local-files.ts         # E2E の LOCAL_FILE_ROOTS（fixtures/local-files）と LOCAL_FILE_WRITE_ROOTS（OS の一時フォルダ。コマンドの作業フォルダも兼ねる）（#148）
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
    ├── conversation-fork.spec.ts  # 会話の分岐（応答から分岐して新しい会話が開く・サイドバーの印・分岐元のリンクで元の応答へ移る・分岐元の削除でリンクが消える・user のメッセージにボタンを出さない・続けて質問すると分岐した応答までを履歴に送る（CI はスキップ）・API の失敗のお知らせ）
    ├── keyboard-shortcuts.spec.ts # ショートカットキー（新しい会話・検索欄・サイドバーの開閉・入力欄・前後の会話（端で止まる）・ヘルプ（⌘/・?・設定から）・サイドバーの一覧の ↑↓・Home・End・入力欄の ? は文字・モーダルの間は効かない）
    ├── browser-tools.spec.ts      # ブラウザのツール（一覧への登録・確認用のページの合言葉を読む・ボタンを押す前の承認カードの許可と拒否・許可していない手元のサーバー・名前を引けないホスト（大モデルのみ））
    ├── screenshot.spec.ts         # スクリーンショットテスト（CIスキップ）
    └── screenshot.spec.ts-snapshots/ # ベースラインスナップショット（OS別）
```

### ディレクトリ方針

- **`components/`**: UIコンポーネント（`common/` に共通の部品、`features/<機能>/` に機能の部品）
- **`hooks/`**: カスタムフック（`hooks/<機能>/`）
- **`constants/`**: 2 ファイル以上から使う定数（`constants/<機能>/`）
- **`lib/`**: 外部サービス連携やユーティリティ関数を配置
- **`types/`**: 複数ファイル・機能で共有される型定義を配置
- **UI コンポーネントは Atomic Design で整理する**（#163。詳細は `docs/12-ui-components.md`）。共通の部品は `components/common/{atoms,molecules,templates}/`、機能の部品は `components/features/<機能>/{atoms,molecules,organisms}/` に置き、page（`app/page.tsx`）はフックを呼んで organisms を組み立て、template（`ChatLayout`）へ渡すだけにする
- **`hooks/`・`lib/`・`types/`・`constants/` の中は、機能ごとのディレクトリに分ける**（`src/<hooks|lib|types|constants>/<機能>/`。#160）。直下にファイルを置かない。`components/` は上の Atomic Design の構成に従う。`lib/` は機能（`agent`・`llm`・`chat`・`conversation`）に加え、サーバー専用の `server/` と、サーバー・クライアント共通の `shared/` を持つ。re-export だけの `index.ts`（barrel）は作らず、実ファイルを直接 import する
- **型・定数は「参照範囲」で置き場所を決める**: 1 ファイルに閉じるならコロケーション、2 ファイル以上なら `types/<機能>/`・`constants/<機能>/` へ昇格。**先回りで共通化しない**（詳細は `.claude/rules/typescript.md`）

## データベース設計

### ERD

```
Conversation           Message                     Attachment
┌──────────────┐       ┌──────────────────┐        ┌──────────────────┐
│ id (UUID PK) │──┐    │ id (UUID PK)     │──┐     │ id (UUID PK)     │
│ title        │  │    │ conversationId   │  │     │ messageId        │──→ Message.id (FK)
│ systemPrompt │  │    │ role             │  │     │ position         │
│ createdAt    │  └───<│ content          │  └────<│ mimeType         │    ('image/png' | 'image/jpeg')
│ updatedAt    │       │ metadata         │        │ width / height   │
└──────────────┘       │ createdAt        │        │ size             │
                       └──────────────────┘        │ data (bytea)     │
                                                   │ createdAt        │
                                                   └──────────────────┘
```

削除は Conversation → Message → Attachment とカスケードする。

分岐した会話（#29）は `Conversation.forkedFromMessageId` で分岐元の応答（`Message.id`）を参照する。分岐元の会話を消すと、応答の削除に合わせて `SetNull` で `null` になる（分岐した会話は残る）。

```
Bookmark（#30。応答 1 つに 1 つまで）
┌──────────────────────┐
│ id (UUID PK)         │
│ messageId (UNIQUE FK)│  Message（assistant）を参照。メッセージの削除でカスケード
│ note                 │  メモ（null はメモなし）
│ createdAt / updatedAt│
└──────────────────────┘
```

Conversation → Message → Bookmark ともカスケードする。再生成で応答を置き換えると、その応答のブックマークは消す。

```
PromptTemplate（#28。会話とはリレーションを持たない）
┌──────────────────────┐
│ id (UUID PK)         │
│ name                 │
│ shortcut (UNIQUE)    │  `/` の後ろに打つ名前（小文字）
│ content              │
│ createdAt / updatedAt│
└──────────────────────┘
```

### Prismaスキーマ

```prisma
model Conversation {
  id           String    @id @default(uuid())
  title        String
  systemPrompt String? // 会話の役割（システムプロンプト）。null は役割なし
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  messages     Message[]
  // 分岐した応答（#29）。分岐していない・分岐元が消えた会話は null
  forkedFromMessageId String?
  forkedFromMessage   Message? @relation("ConversationFork", fields: [forkedFromMessageId], references: [id], onDelete: SetNull)

  @@index([forkedFromMessageId])
}

model Message {
  id             String       @id @default(uuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String       // 'user' | 'assistant'
  content        String
  metadata       Json?        // ツール呼び出し情報・思考過程等（nullable）
  createdAt      DateTime     @default(now())
  attachments    Attachment[]
  bookmark       Bookmark?
  forkedConversations Conversation[] @relation("ConversationFork") // この応答から分岐した会話（#29）
}

// メッセージに添付した画像（#6）。user メッセージだけが持つ
model Attachment {
  id        String   @id @default(uuid())
  messageId String
  message   Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  position  Int      // メッセージ内の並び順（0 始まり）
  mimeType  String   // 中身（マジックナンバー）から判定した形式
  width     Int
  height    Int
  size      Int      // バイト数
  data      Bytes
  createdAt DateTime @default(now())

  @@index([messageId])
}

// 入力欄の `/` で呼び出すプロンプトのテンプレート（#28）。会話とはリレーションを持たない
model PromptTemplate {
  id        String   @id @default(uuid())
  name      String   // 表示名（候補・管理画面）
  shortcut  String   @unique // `/` の後ろに打つ名前（先頭の `/` は含めない。小文字で保存する）
  content   String   // 入力欄に入れる本文（前後の空白・改行も書いたまま）
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 応答（assistant のメッセージ）のブックマーク（#30）。1 つの応答に 1 つまで。user のメッセージに付けさせないことは API で検証する
model Bookmark {
  id        String   @id @default(uuid())
  messageId String   @unique
  message   Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  note      String?  // メモ。null はメモなし（空白だけのメモも null にする）
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## データフロー

### チャット送信フロー

1. ユーザーが`ChatBar`でメッセージ入力・送信（IME composition対応）
2. 親コンポーネント（`page.tsx`）がユーザーメッセージをstateに追加
3. 新規会話の場合、`/api/conversations` で会話作成（`skipLoadRef` で競合回避）
4. `/api/conversations/[id]/messages` にユーザーメッセージをDB保存
5. `/api/chat` Route HandlerにPOSTリクエスト送信（会話履歴 + model指定付き）
6. Route HandlerがOllama APIにストリーミングリクエスト送信
7. Ollamaからのストリーミングレスポンスをクライアントに中継
8. フロントエンドがReadableStreamを読み取り、リアルタイムにUIを更新
9. ストリーミング完了後、AIメッセージをDBに保存
10. 新規会話の場合、`/api/conversations/[id]/generate-title` でタイトル自動生成

### 応答の再生成フロー

1. 最後の AI 応答の「再生成」ボタンを押す（`lib/chat/regenerate.ts` が対象と送り直す質問・履歴を求める）
2. 旧応答を同じ ID の空の応答に差し替え、直前の質問で `/api/chat` に送り直す
3. ストリーミング完了後、`PUT /api/conversations/[id]/messages/[messageId]` で DB の旧応答を置き換える
4. 生成に失敗した場合・本文が出る前に停止した場合は旧応答に戻す（DB は書き換えない）

メッセージは画面上の ID をそのまま DB の ID として保存する（`POST` の `id`）。画面と DB の ID が一致するため、置き換える応答を ID で特定できる。

### 添付画像のフロー（#6）

詳細は [13-image-attachment.md](./13-image-attachment.md)。

1. 入力欄の添付ボタン・ドラッグ＆ドロップ・貼り付けで受けた画像を、`useImageAttachments` がブラウザで検証・縮小（長辺 1,280px）・再エンコードし（`lib/chat/image-attachment.ts`）、添付の ID を採番する。入力欄の上にプレビューを出す
2. `POST /api/conversations/[id]/messages` の `attachments` で、user メッセージと画像（Base64）を 1 トランザクションで保存する。形式はサーバーが中身で判定する（PNG / JPEG）
3. `/api/chat` に送信する質問・履歴の添付 ID（`imageIds`）を送る。Route Handler はモデルが画像に対応しているかを Ollama の `/api/show` で確かめ、渡す画像を選んで（新しい順に 8 枚まで）DB から読み、Base64 にして Ollama の `images` へ渡す
4. 送ったメッセージには手元の data: URI で画像を出す。会話を開き直したときは、メッセージ一覧の `attachments`（中身なし）を元に `GET /api/attachments/[id]` で画像を表示する（`MessageImages`。押すと拡大）
5. 選択中のモデルが `/api/models` の `visionModels` に無ければ、画像を添付している間は案内を出して送信させない

### 会話の役割（システムプロンプト）フロー

1. ヘッダーの役割ボタン（現在の役割の表示名。プリセットに一致しなければ「カスタム」、無ければ「役割なし」）で `RoleDialog` を開き、プリセットを選ぶか自由に入力する
2. 既存の会話なら `PATCH /api/conversations/[id]` で保存する。会話を作る前（新規会話）なら `page.tsx` の下書きに持ち、最初の送信の `POST /api/conversations` で会話と同時に保存する
3. 送信のたびに、`useChat` が会話の役割とエージェントのプリセット（エージェントモードのときだけ）を `buildSystemPrompt` で連結し、`/api/chat` の `systemPrompt` として送る
4. `/api/chat` は通常・エージェントとも、後ろに「現在の日時」の節を足し（`withCurrentDate`。#154）、会話履歴の先頭に `role: 'system'` として付ける（`withSystemPrompt`）。役割が無くても日時の節だけは付ける

役割は会話ごとに本文だけを保存する（プリセットの ID は保存しない）。途中で変えた役割は以降の送信（再生成を含む）から効く。

### プロンプトテンプレートのフロー（#28）

1. 画面を開くと `usePromptTemplates` が `GET /api/prompt-templates` で一覧を読む（読めなければ候補を出さない）
2. 入力欄の先頭で `/` を打つと、`ChatBar` が `lib/prompt-template/suggest.ts` で絞り込み、入力欄の上に候補（`PromptTemplateSuggestions`）を出す
3. ↑↓・Enter・Tab・クリックで選ぶと、入力欄の `/…` をテンプレートの本文に置き換える。送信・`/api/chat` には何も足さない（本文は普通の user メッセージとして送る）
4. 管理画面（`PromptTemplateDialog`）での作成・置き換え・削除・例の追加は `/api/prompt-templates` の各 API を呼び、成功したら一覧を読み直す

### 応答のブックマークのフロー（#30）

1. 会話を開くと、`GET /api/conversations/[id]/messages` の各メッセージの `bookmark`（付いていればその ID）を `useChat` が `Message.bookmarkId` にする
2. 応答の下のボタンを押すと、`useMessageBookmark` が `POST /api/bookmarks`（付ける）か `DELETE /api/bookmarks/[id]`（外す）を呼ぶ。返事を待つ間はボタンを向かう先の状態で出して押させず、成功したら `useChat` の `setMessageBookmark` で表示に反映する。失敗したら元の表示に戻して失敗を出す
3. サイドバーのボタンで一覧のダイアログ（`BookmarkDialog`）を開くと、`useBookmarks` が `GET /api/bookmarks` で新しい順に 20 件ずつ読む。キーワードは入力が止まって 300ms 後に読み直す（メモ・応答の本文・会話のタイトル。会話の検索と同じ解釈）
4. 一覧の行を押すと、page が移る先（会話の ID・応答の ID）を持ってその会話を開き、`ChatWindow` がメッセージ一覧に移る先が現れたら画面の中央までスクロールして 2 秒だけ枠で示す（その間は一番下へのスクロールをしない）
5. 一覧で外すと、開いている会話のその応答の印も `setMessageBookmark` で消す

### 会話の分岐のフロー（#29）

1. 応答の下の「ここから分岐」を押すと、`useConversationFork` が `POST /api/conversations/[id]/fork` を呼ぶ。返事を待つ間はどの応答の分岐のボタンも押させない
2. API は、表示と同じ順（`createdAt` の昇順）でその応答までのメッセージを、本文・`createdAt`（元のまま）・metadata・添付画像（中身ごと新しい ID で）ごと新しい会話にコピーする。metadata の中のツールの画面の ID はコピーした画像の ID に書き換え、ブックマークはコピーしない。タイトルは `（分岐）` を足し、役割は元のまま。1 回の入れ子の作成で行い、途中で失敗したら何も残さない
3. 成功したら、page が会話一覧を読み直し、新しい会話を開いて入力欄にフォーカスする。失敗したら、分岐元の会話を開いている間だけお知らせを出す
4. 分岐した会話を開いている間、ヘッダーに分岐元のリンク（`GET /api/conversations` の `forkedFrom`）を出す。押すと、ブックマークと同じ移る先の仕組みで、分岐元の会話のその応答へ移る

### 会話管理フロー

1. ページ読み込み時に `/api/conversations` から会話一覧を取得
2. サイドバーに一覧表示
3. 会話選択時に `/api/conversations/[id]/messages` からメッセージを取得
   - サイドバーの検索欄にキーワードを入れると、入力が 300ms 止まった後に `GET /api/conversations/search` で会話を探し、履歴一覧の代わりに結果（タイトル・一致箇所の抜粋）を出す。結果を押すとその会話を選択する（#11）
4. 新規会話作成時に `/api/conversations` にPOST
5. New Conversationボタンで新規会話モードに切替（`currentConversationId = null`）

### ストリーミング実装方針

- **API側**: Ollama `/api/chat` エンドポイントの `stream: true` オプションを使用
- **Route Handler**: `ReadableStream` を返す `Response` オブジェクトを生成
- **フロントエンド**: `fetch` + `ReadableStream` で逐次読み取り

## 環境変数

| 変数名 | 説明 | デフォルト値 |
|--------|------|-------------|
| `OLLAMA_BASE_URL` | Ollama APIの接続先 | `http://localhost:11434` |
| `OLLAMA_MODEL` | 使用するモデル名 | `qwen3.8:27b` |
| `DATABASE_URL` | PostgreSQL接続文字列 | `postgresql://postgres:postgres@localhost:5499/chat_db` |
| `AGENT_MAX_TOOL_ROUNDS` | エージェントループの最大ラウンド数 | `10` |
| `AGENT_TOOL_TIMEOUT_MS` | ツール実行タイムアウト（ms） | `30000` |
| `SEARXNG_URL` | Web検索（`web_search`）の SearXNG 接続先 | `http://localhost:8888` |
| `PLANTUML_URL` | PlantUML の図を描く PlantUML サーバーの接続先 | `http://localhost:8889` |
| `LOCAL_FILE_ROOTS` | エージェントのファイルのツール（一覧・検索・読み取り）が読んでよいフォルダの絶対パス（カンマ区切り・`~` 可） | 未設定（ツールを使わない） |
| `LOCAL_FILE_WRITE_ROOTS` | エージェントのファイルの書き込み（作成・編集。実行前に承認が要る）をしてよいフォルダの絶対パス（`LOCAL_FILE_ROOTS` の中だけ・カンマ区切り・`~` 可） | 未設定（書き込みのツールを使わない） |
| `LOCAL_COMMANDS` | エージェントが実行してよいプログラムの名前（カンマ区切り。実行前に承認が要る。作業フォルダは `LOCAL_FILE_WRITE_ROOTS` の中だけ。シェル・`env`・`sudo` 等は書いても使わない） | 未設定（コマンドの実行のツールを使わない） |
| `LOCAL_COMMAND_TIMEOUT_MS` | コマンドの実行時間の上限（ms。上限 600000） | `120000` |
| `GITHUB_REPOS` | エージェントの GitHub のツールで扱ってよいリポジトリ（`owner/name` のカンマ区切り。読むツールは承認なし、コメント・PR の作成は実行前に承認が要る。認証は `gh auth login`） | 未設定（GitHub のツールを使わない） |
| `BROWSER_ENABLED` | `true` でエージェントのブラウザのツール（ページを開く・読む・スクリーンショット・クリック・入力・選択。操作は実行前に承認が要る）を使う（要 `pnpm exec playwright install chromium`） | 未設定（ブラウザのツールを使わない） |
| `BROWSER_LOCAL_ORIGINS` | ブラウザのツールで開いてよい手元の開発サーバーのオリジン（`http://localhost:5173` の形・カンマ区切り。このアプリ自身は書いても開けない） | 未設定（手元のサーバーは開けない） |

## 状態管理

- React `useState` によるローカルstate管理
- グローバルstate管理ライブラリは使用しない
- チャットの状態（メッセージ一覧・生成中・エラー・実行中のツール・停止用の `AbortController`）は `useChat` が**会話ごとに**持ち、表示中の会話の分を返す（#147）。生成中に別の会話へ切り替えても応答は送信した会話に届き続け、戻ると途中までの応答と続きが表示される。停止ボタンは表示中の会話の生成だけを止め、生成中の会話を削除するとその生成を止めて応答を保存しない。会話ごとの更新は `lib/chat/chat-state.ts` の純関数で行う
  - 生成中の会話はサイドバーに点滅する印を出す。同時に生成できる会話の数に上限は設けない（Ollama が順に処理する）
  - 表示していない会話の状態は、生成中・保存に失敗したメッセージ・エラーを持つものだけを残し、他は捨てる（開き直したときに DB から読む）
- 会話履歴はPostgreSQLに永続化し、API経由で取得・保存
- テーマ選択はlocalStorageに永続化（`useTheme`フック）

## テーマシステム

CSS変数ベースのテーマ切替を実装。

- **方式**: `<html>` 要素の `data-theme` 属性で切替
- **CSS**: `globals.css` の `@theme` ディレクティブでCSS変数を定義。`[data-theme='aurora']`, `[data-theme='ocean']` セレクタで変数を上書き
- **状態管理**: `useTheme` フックで `useState` + `useEffect` で管理
- **永続化**: localStorageにテーマIDを保存
- **シンタックスハイライト**: コードブロックのトークン（`.hljs-*`）もテーマ変数で色を付けるため、テーマに追従する。ハイライト専用に `--color-nord-aurora-orange` / `--color-nord-aurora-purple` を全テーマで定義する（[11-syntax-highlight-diagrams.md](./11-syntax-highlight-diagrams.md)）

### テーマ一覧

| テーマID | 名前 | 説明 |
|---------|------|------|
| `nordic` | Nordic Frost | 北欧ブルーのデフォルトテーマ（`data-theme`属性なし） |
| `aurora` | Aurora Borealis | 紫とシアンのオーロラテーマ |
| `ocean` | Midnight Ocean | 深海ブルーのダークテーマ |

### 注意事項

- TailwindCSS 4の `@theme` ディレクティブは `@theme inline` ではなく `@theme` を使用すること。`@theme inline` はCSS変数参照（`var(--color-nord-0)`）ではなく値を直接インラインするため、テーマ切替が機能しない。
- React Compiler環境では、レンダリング中の副作用（DOM操作）が最適化で除去される可能性があるため、DOM操作は必ず `useEffect` 内で行うこと。
