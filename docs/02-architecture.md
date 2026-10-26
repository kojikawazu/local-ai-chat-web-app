# アーキテクチャ設計書

> 最終更新: 2026-10-26

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

```
ブラウザ (Next.js Frontend)
    ↓ fetch (streaming)
Next.js Route Handlers (API層)
    ├──→ Prisma ORM ──→ PostgreSQL (Docker)
    ├──→ HTTP POST (streaming) ──→ Ollama API (localhost:11434) ──→ qwen3.8:27b
    ├──→ web_search ツール ──→ SearXNG (Docker・127.0.0.1:8888) ──→ Google / DuckDuckGo / Brave …
    └──→ /api/diagrams/plantuml ──→ PlantUML サーバー (Docker・127.0.0.1:8889。SANDBOX)
```

- フロントエンドからOllamaへ直接通信しない。Route Handlersを経由する。
- 会話履歴はPostgreSQLに永続化し、Prisma ORMで操作する。添付画像もメッセージに紐づけて PostgreSQL（`bytea`）に置き、`/api/chat` は画像を ID で受けて DB から読み、Ollama へ渡す（#6。`docs/13-image-attachment.md`）。
- Ollama接続先はローカルのみ想定（`localhost:11434`）。
- Web検索は、ローカルの SearXNG（メタ検索エンジン）の JSON API を経由する。SearXNG が複数の検索エンジンに問い合わせるため、1 つがブロックされても結果を返せる（#151）。
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
│       ├── attachments/[id]/
│       │   └── route.ts       #     添付画像の取得（#6）
│       ├── chat/
│       │   └── route.ts       #     Ollama通信（通常 / エージェント、model指定可。添付画像は ID で受ける）
│       ├── diagrams/plantuml/
│       │   └── route.ts       #     PlantUML の図の描画（PlantUML サーバーへ中継。#171）
│       ├── models/
│       │   └── route.ts       #     利用可能モデル一覧取得
│       ├── tools/
│       │   └── route.ts       #     エージェントの利用可能ツール一覧取得
│       └── conversations/
│           ├── route.ts       #     会話一覧取得・新規作成
│           ├── search/
│           │   └── route.ts   #     会話のキーワード検索（#11）
│           └── [id]/
│               ├── route.ts   #     会話の役割の変更（PATCH）・会話削除
│               ├── generate-title/
│               │   └── route.ts #   LLMで会話タイトル自動生成
│               └── messages/
│                   ├── route.ts #   メッセージ取得・保存
│                   └── [messageId]/
│                       └── route.ts # 応答の置き換え（再生成）
├── components/                # UIコンポーネント（Atomic Design。#163）
│   ├── common/                #   共通の部品（ドメインを知らない）
│   │   ├── atoms/             #     Button・IconButton・ToggleChip・Switch・TextInput・TextArea・Select・Mark・StatusDot・LoadingDots
│   │   ├── molecules/         #     Modal（ネイティブの <dialog> の外枠。幅は md / wide）・SearchBox（検索欄）・CopyButton（コピーと結果の一時表示）・CodeBlockFrame（コードブロックの枠と見出し行）
│   │   └── templates/
│   │       └── ChatLayout.tsx #     画面の枠（サイドバー・ドロワー・ヘッダー・本文・お知らせ・入力欄・フッター）。中身は props で受け取る
│   └── features/              #   機能の部品
│       ├── chat/
│       │   ├── atoms/
│       │   │   └── AttachButton.tsx      # 画像を添付するクリップのボタン（隠したファイル選択を開く。#6）
│       │   ├── molecules/
│       │   │   ├── AttachmentPreview.tsx # 送信前の添付画像のサムネイル・削除・準備中・添付できなかった理由・非対応モデルの案内（#6）
│       │   │   ├── MessageImages.tsx     # メッセージの中の添付画像のサムネイル（押すと拡大。#6）
│       │   │   ├── ImageZoomDialog.tsx   # 添付画像の拡大のダイアログ（#6）
│       │   │   ├── ToolCallIndicator.tsx # ツール実行中インジケーター
│       │   │   ├── WebSearchResult.tsx   # web_search の結果をリンク付きの一覧に整形
│       │   │   ├── DiagramView.tsx       # 描画の状態に応じて図（data: URI の img）かソースとエラーを表示。ソースとの切り替え・拡大のボタン（#169・#171・#176）
│       │   │   └── DiagramZoomDialog.tsx # 図の拡大（倍率の変更）と SVG / PNG での保存のダイアログ（#176）
│       │   └── organisms/
│       │       ├── ChatBar.tsx    # メッセージ入力（IME対応・画像の添付ボタン / ドラッグ＆ドロップ / 貼り付け）
│       │       ├── ChatWindow.tsx # メッセージ一覧表示
│       │       ├── Footer.tsx     # フッター
│       │       ├── Header.tsx     # ヘッダー（サイドバーの切り替え・会話の役割の表示と編集の入口・モデル選択ドロップダウン）
│       │       ├── RoleDialog.tsx # 会話の役割（システムプロンプト）の編集ダイアログ（プリセット・自由入力）
│       │       ├── ExportDialog.tsx # 会話全体の書き出しの形式（Markdown・JSON）を選ぶダイアログ（#12）
│       │       ├── MarkdownContent.tsx # Markdown整形表示（コードブロックのシンタックスハイライト・言語名・コピーボタン付き。mermaid は図）
│       │       ├── AgentThinking.tsx   # エージェント思考過程の表示（<think> タグ / message.thinking 対応）
│       │       └── ToolCallResult.tsx  # ツール実行結果の折りたたみ表示
│       ├── sidebar/
│       │   ├── molecules/
│       │   │   ├── ConversationListItem.tsx # 履歴の 1 行（生成中の印・削除ボタン）
│       │   │   └── SearchResultItem.tsx     # 検索結果の 1 件（タイトル・抜粋の強調）
│       │   └── organisms/
│       │       ├── Sidebar.tsx    # デスクトップのサイドバー（md 以上。隠すと幅 0・inert。#24）
│       │       ├── SidebarDrawer.tsx # モバイルのサイドバードロワー（md 未満）
│       │       ├── SidebarContent.tsx # サイドバーの中身（会話一覧、新規会話、設定ボタン）。上記 2 つが共有
│       │       └── ConversationSearch.tsx # 会話の検索欄と検索結果
│       └── settings/
│           └── organisms/
│               └── SettingsModal.tsx # 設定モーダル（モデル選択・ツール・エージェントのプリセット・テーマ切替）
├── constants/                 # 定数（機能ごとのディレクトリ）
│   └── chat/
│       ├── toolLabels.ts      #     ツール名→表示ラベルのマッピング
│       └── imageAttachment.ts #     添付を受け付ける画像の形式（#6）
├── generated/
│   └── prisma/                #   Prisma自動生成クライアント（出力先カスタマイズ）
├── hooks/                     # カスタムフック（機能ごとのディレクトリ）
│   ├── chat/
│   │   ├── useChat.ts         #     チャットロジック（ストリーミング、NDJSON、タイトル生成、会話ごとの状態）
│   │   ├── useModels.ts       #     利用可能なモデル一覧（画像に対応したモデルを含む）の取得と選択中のモデル
│   │   ├── useImageAttachments.ts # 送信前の添付画像（追加・前処理・削除・添付できなかった理由。#6）
│   │   ├── useMermaidDiagram.ts #   mermaid の読み込み・テーマの色での描画・テーマ切替での描き直し（#169）
│   │   └── usePlantUmlDiagram.ts #  /api/diagrams/plantuml で PlantUML の図を描かせる（#171）
│   ├── clipboard/
│   │   └── useCopyFeedback.ts #     コピーの実行と結果表示（copied / failed）の自動リセット
│   ├── settings/
│   │   └── useAgentSettings.ts #    ツール使用の有効状態・エージェントのプリセット（localStorage永続化）
│   ├── sidebar/
│   │   ├── useConversations.ts #    会話CRUD管理
│   │   ├── useConversationSearch.ts # 会話検索（入力の待ち合わせ・前の要求の中断・さらに表示）
│   │   ├── useDrawerDialog.ts #     ドロワーのフォーカス管理・Escape・スクロール固定
│   │   └── useSidebarVisibility.ts # デスクトップのサイドバーの表示・非表示と localStorage への保存（#24）
│   └── theme/
│       └── useTheme.ts        #     テーマ切替フック（localStorage永続化）
├── lib/                       # ユーティリティ・外部連携（機能ごとのディレクトリ）
│   ├── agent/                 #   エージェント
│   │   ├── agent.ts           #     エージェントループ（ツール呼び出し制御・最大ラウンド到達時の最終回答）
│   │   ├── agent-config.ts    #     エージェント設定の環境変数の検証（範囲外は既定値へ戻す）
│   │   ├── agent-prompts.ts   #     エージェントモードのシステムプロンプトプリセット定義
│   │   └── tools/             #     ツール実装
│   │       ├── types.ts       #       ツール関連型定義
│   │       ├── index.ts       #       ツールレジストリ（register/get/execute）
│   │       ├── output.ts      #       ツールの実行結果の組み立て（失敗の toolError・接続先ごと使えない失敗の toolUnavailable）
│   │       ├── registry.ts    #       ツール登録の初期化（initializeTools）
│   │       ├── get-current-datetime.ts # 現在日時取得ツール
│   │       ├── calculate.ts   #       数式計算ツール
│   │       ├── web-search.ts  #       Web検索ツール（SearXNG）
│   │       ├── url-fetch.ts   #       URL取得ツール（SSRF防止）
│   │       ├── read-body.ts   #       本文のバイト上限付きストリーム読み取り（外部取得の共通処理）
│   │       └── local-files/   #       ローカルのファイルのツール（#148。LOCAL_FILE_ROOTS があるときだけ登録）
│   │           ├── config.ts  #         LOCAL_FILE_ROOTS の解釈（~・realpath・不正値の警告）
│   │           ├── path-guard.ts #      パスの判定（実体のパスでの包含・秘匿ファイル・たどらないフォルダ）
│   │           ├── text.ts    #         バイナリの判定・行の切り出し・ワイルドカード
│   │           ├── list-directory.ts #  フォルダの直下の一覧
│   │           ├── search-files.ts #    ファイル名・中身の検索
│   │           └── read-file.ts #       行番号付きの読み取り
│   ├── llm/                   #   LLM（Ollama）との通信
│   │   ├── ollama.ts          #     Ollamaクライアント（streamChat / chatOnce / listModels / getDefaultModel。接続先・モデル解決の唯一の窓口）
│   │   └── current-date.ts    #     システムプロンプトの後ろに足す「現在の日時」の節（#154）
│   ├── chat/                  #   チャット（チャットの部品・useChat から使う）
│   │   ├── chat-state.ts      #     会話ごとのチャット状態の更新（切り替え・読み込み・不要な状態の破棄。#147）
│   │   ├── conversation-history.ts # 表示中のメッセージから /api/chat へ渡す会話履歴を組み立てる（上限内に収める）
│   │   ├── message-metadata.ts #    メッセージ metadata の組み立て・取得時の実行時検証
│   │   ├── regenerate.ts      #     再生成できる応答の判定と、送り直す質問・履歴の組み立て
│   │   ├── system-prompt.ts   #     会話の役割のプリセット・表示名の逆引き・役割とエージェントのプリセットの連結
│   │   ├── code-block.ts      #     コードブロックの構文木から言語名・コピーする本文を取り出す
│   │   ├── diagram.ts         #     Mermaid の判定・要素 ID・SVG の data: URI と大きさ・テーマの色の組み立て（#169）
│   │   ├── image-attachment.ts #    添付画像の選別（形式・大きさ・枚数）とブラウザでの縮小・再エンコード（#6）
│   │   └── export.ts          #     応答・会話の書き出し（ファイル名・Markdown / JSON の中身。#12）
│   ├── conversation/          #   会話
│   │   └── search.ts          #     会話検索のキーワードの解釈・抜粋の切り出し・強調の分割・LIKE のエスケープ（#11）
│   ├── sidebar/               #   サイドバー
│   │   └── visibility.ts      #     サイドバーの表示状態の保存値の解釈（#24）
│   ├── server/                #   サーバー専用（app/api/** から使う）
│   │   ├── prisma.ts          #     Prismaクライアントインスタンス
│   │   ├── request-body.ts    #     Route Handler の JSON ボディの実行時検証（parseChatBody 等）
│   │   ├── plantuml.ts        #     PlantUML サーバーとの通信（POST /svg・エラーの解釈。#171）
│   │   ├── attachment.ts      #     添付画像の形式の判定（マジックナンバー）・Base64 の復号（#6）
│   │   └── chat-images.ts     #     /api/chat で LLM へ渡す画像の選び方・省略の注記（#6）
│   └── shared/                #   サーバー・クライアント共通
│       ├── validation.ts      #     入力の上限値・UUID の検証（フロントと API が同じ定数を使う）
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
    │   └── diagram.ts         #     DiagramKind・DiagramState（図の種類と描画の状態）
    ├── conversation/
    │   └── conversation.ts    #     Conversation・ConversationSearchResult
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
    ├── tool-result-summary.spec.ts # ツールの結果パネルの見出し（件数・0 件・失敗の理由）
    ├── local-files.spec.ts        # ローカルのファイルのツール（一覧への登録・保存済みの結果の表示・止めた外部のツール・実際に読ませる（大モデルのみ））
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

### Prismaスキーマ

```prisma
model Conversation {
  id           String    @id @default(uuid())
  title        String
  systemPrompt String? // 会話の役割（システムプロンプト）。null は役割なし
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  messages     Message[]
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
