# エージェント機能 設計書

> 最終更新: 2026-06-11

## 目次

- [概要](#概要)
  - [段階的ロードマップ](#段階的ロードマップ)
  - [スコープ外](#スコープ外)
- [Ollama Tool Calling プロトコル](#ollama-tool-calling-プロトコル)
  - [リクエスト](#リクエスト)
  - [ストリーミングレスポンス（ツール呼び出し時）](#ストリーミングレスポンスツール呼び出し時)
  - [ツール結果の返送](#ツール結果の返送)
  - [複数ツール同時呼び出し](#複数ツール同時呼び出し)
- [アーキテクチャ](#アーキテクチャ)
  - [Phase A: 全体構成（ツール呼び出し基盤）](#phase-a-全体構成ツール呼び出し基盤)
  - [Phase B: 調査系ツール追加](#phase-b-調査系ツール追加)
  - [Phase C: 自律エージェント化](#phase-c-自律エージェント化)
  - [新規ファイル構成](#新規ファイル構成)
- [データフロー](#データフロー)
  - [エージェント対応チャット送信フロー](#エージェント対応チャット送信フロー)
  - [ツール呼び出しループ（最大回数制限付き）](#ツール呼び出しループ最大回数制限付き)
  - [Phase C での拡張（自律エージェント）](#phase-c-での拡張自律エージェント)
- [ストリーミングプロトコル（クライアント↔サーバー）](#ストリーミングプロトコルクライアントサーバー)
  - [現行プロトコル（テキストのみ）](#現行プロトコルテキストのみ)
  - [新プロトコル（NDJSON イベントストリーム）](#新プロトコルndjson-イベントストリーム)
  - [イベント型一覧](#イベント型一覧)
  - [後方互換性](#後方互換性)
- [ツール設計](#ツール設計)
  - [ツールインターフェース](#ツールインターフェース)
  - [ツールレジストリ](#ツールレジストリ)
- [ツール一覧](#ツール一覧)
  - [Phase A: 基本ツール](#phase-a-基本ツール)
    - [1. get_current_datetime（日時取得）](#1-get_current_datetime日時取得)
    - [2. calculate（計算）](#2-calculate計算)
  - [Phase B: 調査系ツール](#phase-b-調査系ツール)
    - [3. web_search（Web検索）](#3-web_searchweb検索)
    - [4. url_fetch（URL取得）](#4-url_fetchurl取得)
- [API 設計変更](#api-設計変更)
  - [POST /api/chat（変更）](#post-apichat変更)
  - [GET /api/tools（新規 — Phase A）](#get-apitools新規--phase-a)
- [DB スキーマ変更](#db-スキーマ変更)
  - [Message モデルの拡張（Phase A）](#message-モデルの拡張phase-a)
  - [metadata フィールドの構造](#metadata-フィールドの構造)
  - [ツールメッセージ（role: 'tool'）の DB 保存方針](#ツールメッセージrole-toolの-db-保存方針)
- [型定義](#型定義)
  - [バックエンド型（lib/tools/types.ts）](#バックエンド型libtoolstypests)
  - [フロントエンド型（types/index.ts 拡張）](#フロントエンド型typesindexts-拡張)
- [フロントエンド変更](#フロントエンド変更)
  - [Phase A: 基盤](#phase-a-基盤)
    - [useChat フックの拡張](#usechat-フックの拡張)
    - [ToolCallIndicator コンポーネント](#toolcallindicator-コンポーネント)
    - [ToolCallResult コンポーネント](#toolcallresult-コンポーネント)
    - [設定 UI 変更](#設定-ui-変更)
  - [Phase B: 調査系ツール追加](#phase-b-調査系ツール追加-1)
  - [Phase C: 自律エージェント化](#phase-c-自律エージェント化-1)
    - [thinking イベントのソース（実装済み）](#thinking-イベントのソース実装済み)
    - [AgentThinking コンポーネント（実装済み）](#agentthinking-コンポーネント実装済み)
    - [システムプロンプトのプリセット（`lib/agent-prompts.ts`）](#システムプロンプトのプリセットlibagent-promptsts)
    - [実行統計の表示](#実行統計の表示)
- [設定](#設定)
  - [環境変数](#環境変数)
  - [CI 環境でのエージェントテスト](#ci-環境でのエージェントテスト)
- [エラーハンドリング](#エラーハンドリング)
- [セキュリティ考慮事項](#セキュリティ考慮事項)
- [技術検証結果（参考）](#技術検証結果参考)
  - [設計上の重要ポイント](#設計上の重要ポイント)

## 概要

既存のチャット機能を拡張し、LLM がツール（関数）を呼び出して外部情報を取得・処理できるエージェント機能を実装する。
Ollama のネイティブ Tool Calling API を使用し、LangChain 等のフレームワークは使わない（プロジェクトの「薄いラッパー」方針に準拠）。

最終的には Claude Code のような「判断→行動→結果を見て再判断」の自律ループを実現する。
学習目的を踏まえ、3段階に分けて段階的に構築する。

### 段階的ロードマップ

| フェーズ | 名称 | ゴール |
|---------|------|--------|
| Phase A | ツール呼び出し基盤 | Ollama の tool calling が動く最小構成。シンプルなツール（日時取得、計算）で仕組みを理解 |
| Phase B | 調査系ツール追加 | Web 検索・URL 取得を追加。複数ツールの連携動作を体験 |
| Phase C | 自律エージェント化 | 判断→行動→再判断の自律ループ強化。システムプロンプトで思考を促し、UI で思考過程を可視化 |

### スコープ外

- RAG（検索拡張生成）— 別 issue #17 で対応
- カスタムツールの動的追加（UI からのツール定義） — 将来的な拡張として検討

---

## Ollama Tool Calling プロトコル

### リクエスト

```json
POST /api/chat
{
  "model": "qwen3-coder-next:latest",
  "messages": [
    { "role": "user", "content": "今日の日付は？" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_current_datetime",
        "description": "現在の日付と時刻を取得する",
        "parameters": {
          "type": "object",
          "properties": {
            "timezone": {
              "type": "string",
              "description": "タイムゾーン (例: Asia/Tokyo)"
            }
          },
          "required": []
        }
      }
    }
  ],
  "stream": true
}
```

### ストリーミングレスポンス（ツール呼び出し時）

技術検証の結果、ストリーミング時の tool_calls は `done: false` のチャンクに一括で含まれる（テキストのように文字単位で分割されない）:

```json
{"model":"qwen3-coder-next:latest","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"get_current_datetime","arguments":{"timezone":"Asia/Tokyo"}}}]},"done":false}
{"model":"qwen3-coder-next:latest","message":{"role":"assistant","content":""},"done":true}
```

### ツール結果の返送

ツール実行結果は `role: "tool"` メッセージで返送する。assistant メッセージの `tool_calls` も履歴に含める必要がある:

```json
{
  "messages": [
    { "role": "user", "content": "今日の日付は？" },
    { "role": "assistant", "content": "", "tool_calls": [{ "function": { "name": "get_current_datetime", "arguments": { "timezone": "Asia/Tokyo" } } }] },
    { "role": "tool", "content": "2026-04-02T15:30:00+09:00" }
  ],
  "tools": [...]
}
```

### 複数ツール同時呼び出し

1 レスポンスで複数ツールを並列呼び出しする場合、`tool_calls` 配列に複数エントリが入る。各ツールは `index` フィールドで区別される。

**実行方式**: `Promise.allSettled()` で並列実行する。`Promise.all()` ではなく `allSettled` を使用することで、一部のツールが失敗しても他のツール結果は正常に取得できる。

```typescript
// 擬似コード
const results = await Promise.allSettled(
  toolCalls.map(tc => executeTool(tc.function.name, tc.function.arguments))
);
// 各結果を fulfilled / rejected に応じて role: "tool" メッセージに変換
```

**順序保証**: `tool_calls` 配列のインデックス順に `role: "tool"` メッセージを並べて Ollama に返送する（結果の完了順ではなく、呼び出し順）。

---

## アーキテクチャ

### Phase A: 全体構成（ツール呼び出し基盤）

```
ブラウザ (Next.js Frontend)
    ↓ fetch (NDJSON event stream)
Next.js Route Handlers (API層)
    ├──→ Prisma ORM ──→ PostgreSQL (Docker)
    ├──→ Ollama API (Tool Calling 対応)
    └──→ Tool Executor ──→ 各ツール実装
            ├── get_current_datetime
            └── calculate
```

### Phase B: 調査系ツール追加

```
Tool Executor
    ├── get_current_datetime
    ├── calculate
    ├── web_search          ← 追加
    └── url_fetch           ← 追加
```

### Phase C: 自律エージェント化

```
ブラウザ (Next.js Frontend)
    ↓ fetch (NDJSON event stream — 思考過程表示付き)
Next.js Route Handlers (API層)
    ├──→ Agent Loop（自律判断ループ）
    │       ├── System Prompt（自律思考を促す指示）
    │       ├── Ollama API（推論 + ツール選択）
    │       └── Tool Executor（ツール実行）
    │           ├── get_current_datetime
    │           ├── calculate
    │           ├── web_search
    │           └── url_fetch
    └──→ Prisma ORM ──→ PostgreSQL
```

### 新規ファイル構成

```
front/src/
├── lib/
│   ├── ollama.ts                      # 既存（Tool Calling 対応に拡張）
│   ├── tools/
│   │   ├── index.ts                   # ツールレジストリ（定義一覧・実行ディスパッチ）
│   │   ├── types.ts                   # ツール関連の型定義
│   │   ├── get-current-datetime.ts    # [Phase A] 日時取得ツール
│   │   ├── calculate.ts              # [Phase A] 計算ツール
│   │   ├── web-search.ts             # [Phase B] Web検索ツール
│   │   └── url-fetch.ts              # [Phase B] URL取得ツール
│   └── agent.ts                       # エージェントループ（ツール呼び出し→結果返送→繰り返し）
├── features/
│   └── chat/
│       ├── components/
│       │   ├── ToolCallIndicator.tsx   # [Phase A] ツール実行中インジケーター
│       │   ├── ToolCallResult.tsx      # [Phase A] ツール実行結果の表示
│       │   └── AgentThinking.tsx       # [Phase C] エージェント思考過程の表示
│       └── types/
│           └── index.ts               # エージェント関連のフロントエンド型
```

---

## データフロー

### エージェント対応チャット送信フロー

```
1. ユーザーがメッセージ送信
2. Route Handler がメッセージ + ツール定義を Ollama に送信（ストリーミング）
3. Ollama のレスポンスを解析:
   a. テキストレスポンス → クライアントにテキストイベントを送信
   b. tool_calls レスポンス →
      i.   クライアントに tool_call_start イベントを送信
      ii.  サーバー側でツールを実行
      iii. クライアントに tool_call_result イベントを送信
      iv.  ツール結果を含めて Ollama に再送信 → 3に戻る
4. Ollama が最終テキスト応答を返す → クライアントにストリーミング送信
5. 完了 → クライアントに done イベントを送信
6. AI メッセージ（ツール実行メタデータ付き）を DB に保存
```

### ツール呼び出しループ（最大回数制限付き）

```
MAX_TOOL_ROUNDS = 10（無限ループ防止）

for round in 1..MAX_TOOL_ROUNDS:
    response = ollama.chat(messages, tools, stream=true)
    if response has tool_calls:
        execute tools → append results to messages
        continue
    else:
        stream text response to client
        break
```

### Phase C での拡張（自律エージェント）

Phase C では、LLM に「調査→判断→再調査」の自律ループを促すシステムプロンプトを導入する:

```
ユーザー: 「Rustの非同期処理について調べて、Goと比較してまとめて」

エージェントループ:
  Round 1: LLM →「まずRustの非同期の概要を調べる」
           → web_search("Rust async await overview")
  Round 2: LLM →「基本は分かった、次にGoのgoroutineを調べる」← 結果を判断
           → web_search("Go goroutine concurrency model")
  Round 3: LLM →「比較するには性能データも欲しい」← 不足を判断
           → web_search("Rust async vs Go goroutine benchmark")
  Round 4: LLM →「十分な情報が揃った、まとめよう」← 完了を判断
           → 比較表付きレポートを生成（テキストストリーミング）
```

---

## ストリーミングプロトコル（クライアント↔サーバー）

### 現行プロトコル（テキストのみ）

```
Content-Type: text/plain
<プレーンテキストのバイトストリーム>
```

### 新プロトコル（NDJSON イベントストリーム）

現行の実装は `ReadableStream` ベースであり SSE（Server-Sent Events）ではないため、NDJSON 形式には `application/x-ndjson` を使用する。SSE の `text/event-stream`（`data:` プレフィックス + `\n\n` 区切り）とは異なる形式である点に注意。

```
Content-Type: application/x-ndjson

{"type":"text_delta","content":"調べてみますね。"}
{"type":"tool_call_start","name":"web_search","arguments":{"query":"Rust async"}}
{"type":"tool_call_result","name":"web_search","result":"...検索結果...","isError":false}
{"type":"text_delta","content":"Rustの非同期処理は..."}
{"type":"done","metadata":{"toolCalls":[...]}}
```

### イベント型一覧

| type | フィールド | 説明 | Phase |
|------|-----------|------|-------|
| `text_delta` | `content: string` | テキスト差分（1チャンク分） | A |
| `tool_call_start` | `name: string`, `arguments: object` | ツール呼び出し開始 | A |
| `tool_call_result` | `name: string`, `result: string`, `isError: boolean` | ツール実行結果 | A |
| `done` | `metadata?: { toolCalls: ToolCallRecord[]; agentRounds?: number; agentDurationMs?: number }` | ストリーミング完了（実行統計付き） | A/C |
| `error` | `message: string` | エラー発生 | A |
| `thinking` | `content: string` | エージェントの思考過程 | C |

### 後方互換性

エージェントモード無効時（ツール定義なし）は、従来のプレーンテキストストリーミングを維持する。

フロントエンドはレスポンスの **`Content-Type` ヘッダー**でフォーマットを判定する:
- `application/x-ndjson` → NDJSON イベントストリームとしてパース
- `text/plain`（またはそれ以外）→ 従来のプレーンテキストとして処理

最初のバイト（`{` かどうか）での判定は、AI の応答が偶然 `{` で始まる場合に誤判定するため採用しない。

---

## ツール設計

### ツールインターフェース

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

interface Tool {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>) => Promise<string>;
}
```

### ツールレジストリ

```typescript
// lib/tools/index.ts
const toolRegistry: Map<string, Tool> = new Map();

function registerTool(tool: Tool): void;
function getTool(name: string): Tool | undefined;
function getAllToolDefinitions(): OllamaToolDefinition[];
function executeTool(name: string, args: Record<string, unknown>): Promise<string>;
```

---

## ツール一覧

### Phase A: 基本ツール

#### 1. get_current_datetime（日時取得）

| 項目 | 内容 |
|------|------|
| 名前 | `get_current_datetime` |
| 説明 | 現在の日付と時刻を取得する |
| パラメータ | `timezone` (string, optional) — タイムゾーン（デフォルト: Asia/Tokyo） |
| 戻り値 | ISO 8601 形式の日時文字列（例: `2026-04-02T15:30:00+09:00`） |
| 実装 | タイムゾーン指定なし: `new Date().toISOString()`。タイムゾーン指定あり: `Intl.DateTimeFormat` + offset 計算で ISO 8601 フォーマット生成。`new Date().toLocaleString()` はロケール依存文字列を返すため使用しない |

#### 2. calculate（計算）

| 項目 | 内容 |
|------|------|
| 名前 | `calculate` |
| 説明 | 数式を計算して結果を返す |
| パラメータ | `expression` (string, required) — 計算式（例: `2 + 3 * 4`） |
| 戻り値 | 計算結果の文字列 |
| 実装 | **手書きの再帰下降パーサー**で四則演算 + 括弧を評価する。または外部ライブラリ `mathjs` の導入を検討（新規依存追加とのトレードオフ） |
| セキュリティ | **`Function()` コンストラクタの使用も禁止**。文字制限だけではバイパスリスクがあるため、パーサーレベルで安全性を担保する |

### Phase B: 調査系ツール

#### 3. web_search（Web検索）

| 項目 | 内容 |
|------|------|
| 名前 | `web_search` |
| 説明 | Web を検索して結果を取得する |
| パラメータ | `query` (string, required) — 検索クエリ |
| 戻り値 | 検索結果のタイトル・URL・スニペット一覧（JSON 文字列） |
| 実装 | 下記「検索エンジン選定」を参照 |
| 制限 | 結果を上位5件に制限、レスポンスを3,000文字以内にトリム |
| リトライ | 条件に応じてリトライ（下記「リトライ条件」参照） |

**検索エンジン選定:**

| 候補 | メリット | デメリット |
|------|---------|-----------|
| DuckDuckGo HTML スクレイピング | API キー不要、手軽 | 非公式 API のため仕様変更・ブロックのリスクあり。レートリミット不明 |
| SearXNG（セルフホスト） | ローカル環境方針に合致。安定した JSON API。複数検索エンジンを集約 | Docker Compose への追加が必要。セットアップコスト |
| Brave Search API | 公式 API、無料枠あり | API キー必要。外部依存 |

**推奨**: 初期実装は **DuckDuckGo** で手軽に動作確認し、安定性が問題になった段階で **SearXNG** に移行する。SearXNG は `docker-compose.yml` に追加するだけでローカル環境に組み込める。

> **⚠️ 既知の制限事項 — DuckDuckGo HTML スクレイピングの安定性**
>
> `html.duckduckgo.com/html/` は非公式エンドポイントであり、HTML 内の CSS クラス名（`result__a`・`result__snippet`）が変更された場合、検索結果をサイレントに取得できなくなるリスクがある。
> 正規 JSON API（`api.duckduckgo.com/?format=json`）は安定しているが返せる情報量が限られる。
> 安定性問題が顕在化した場合は SearXNG への移行を推奨する。

**リトライ条件**:

| 状況 | リトライ | 理由 |
|------|---------|------|
| ネットワークエラー・接続タイムアウト | ✅ 最大2回（1秒間隔） | 一時的な障害の可能性 |
| HTTP 5xx（サーバーエラー） | ✅ 最大2回（1秒間隔） | サービス一時障害の可能性 |
| HTTP 429（レートリミット） | ✅ 最大2回（Exponential Backoff: 2秒 → 4秒） | 時間を置けば回復する可能性 |
| HTTP 4xx（Bad Request 等） | ❌ リトライしない | クエリや設定の問題のためリトライしても無意味 |
| パースエラー（HTML 構造変化等） | ❌ リトライしない | リトライしても同じ結果になる |

#### 4. url_fetch（URL取得）

| 項目 | 内容 |
|------|------|
| 名前 | `url_fetch` |
| 説明 | 指定 URL のコンテンツを取得する |
| パラメータ | `url` (string, required) — 取得対象の URL |
| 戻り値 | ページのテキストコンテンツ（HTML タグ除去済み） |
| 制限 | レスポンスを5,000文字以内にトリム |
| Content-Type | `text/html` および `text/plain` のみ処理する。それ以外（`application/json`、`application/pdf`、バイナリ等）はエラーを返す。LLM への不適切なバイナリデータ送信を防止するため |
| セキュリティ | 下記「SSRF 防止ブロックリスト」および「リダイレクト処理」を参照 |

**SSRF 防止ブロックリスト（url_fetch ツール）:**

URL のホスト名を DNS 解決した後の IP アドレスに対して、以下のプライベート・特殊アドレス範囲をブロックする:

| 範囲 | 区分 | 説明 |
|------|------|------|
| `127.0.0.0/8` | IPv4 | ループバック |
| `10.0.0.0/8` | IPv4 | RFC 1918 プライベート |
| `172.16.0.0/12` | IPv4 | RFC 1918 プライベート |
| `192.168.0.0/16` | IPv4 | RFC 1918 プライベート |
| `169.254.0.0/16` | IPv4 | リンクローカル |
| `0.0.0.0/8` | IPv4 | 特殊（カレントネットワーク） |
| `::1` | IPv6 | ループバック |
| `fc00::/7` | IPv6 | ユニークローカルアドレス（ULA） |
| `fe80::/10` | IPv6 | リンクローカル |

**重要**:
- ホスト名（例: `localhost`）を先に DNS 解決し、解決後の IP アドレスに対してブロックリストを適用する。
- Node.js の `net` モジュールで IP をパースする際、IPv4-mapped IPv6 形式（例: `::ffff:192.168.1.1`）で返ってくる場合がある。この場合は **IPv4 アドレス部分（`192.168.1.1`）に正規化してから** 上記の IPv4 ブロックリストと照合すること。`::ffff:0:0/96` をブロックリストに直接追加すると全パブリック IP も含んでしまうため不可。

**TOCTOU（Time-of-Check-Time-of-Use）の制限事項**:

「DNS 解決 → チェック → fetch 実行」のステップ間で DNS が書き換わった場合（DNS rebinding）、チェック通過後にプライベート IP へ接続できる時間差の問題がある。根本的な対策は DNS 解決後の IP アドレスに直接接続することだが、実装コストが高い。**本設計ではローカル個人利用前提のためこの制限事項を許容する。**

なお、`redirect: 'error'` は TOCTOU とは独立した別の攻撃ベクタ（リダイレクト経由の SSRF）を防止するための対策であり、TOCTOU 自体は緩和しない。

**リダイレクト処理**:

Node.js の `fetch()` はデフォルトでリダイレクトに自動追従するため、以下のバイパスが可能になる:

1. 初期 URL `https://example.com` の DNS 解決結果はパブリック IP → SSRF チェックを通過
2. サーバーが `302 Location: http://169.254.169.254/metadata` にリダイレクト
3. リダイレクト先（リンクローカル）が SSRF チェックなしで実行される

対策として `redirect: 'manual'` でリダイレクトを手動処理し、リダイレクト先 URL も同じ SSRF チェックを通す。または `redirect: 'error'` でリダイレクト自体を禁止する（よりシンプルで安全）。**初期実装では `redirect: 'error'` を採用する**。

---

## API 設計変更

### POST /api/chat（変更）

リクエストに `enableTools` / `systemPrompt` フラグを追加:

```typescript
{
  message: string;
  conversationHistory: {
    role: 'user' | 'assistant';
    content: string;
  }[];
  model?: string;
  enableTools?: boolean;    // ツール使用を有効化（デフォルト: false）
  systemPrompt?: string;    // Phase C: システムプロンプト（enableTools: true 時のみ使用）
}
```

**動作:**
- `enableTools: false`（デフォルト）: 従来と同じプレーンテキストストリーミング
- `enableTools: true`: ツール定義を Ollama に渡し、NDJSON イベントストリームで応答
- `systemPrompt` が指定された場合、エージェントループの先頭に `role: 'system'` メッセージとして挿入

### GET /api/tools（新規 — Phase A）

利用可能なツール一覧を返す。

```typescript
// レスポンス
{
  tools: {
    name: string;
    description: string;
    enabled: boolean;
  }[];
}
```

---

## DB スキーマ変更

### Message モデルの拡張（Phase A）

```prisma
model Message {
  id             String       @id @default(uuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String       // 'user' | 'assistant'
  content        String
  metadata       Json?        // 新規: ツール呼び出し情報等（nullable）
  createdAt      DateTime     @default(now())
}
```

### metadata フィールドの構造

ツール呼び出しがあった assistant メッセージの場合:

```json
{
  "toolCalls": [
    {
      "name": "get_current_datetime",
      "arguments": { "timezone": "Asia/Tokyo" },
      "result": "2026-04-02T15:30:00+09:00",
      "isError": false,
      "durationMs": 5
    },
    {
      "name": "web_search",
      "arguments": { "query": "天気 東京" },
      "result": "[{\"title\":\"...\",\"url\":\"...\",\"snippet\":\"...\"}]",
      "isError": false,
      "durationMs": 1200
    }
  ]
}
```

ツール呼び出しがなかった場合: `metadata` は `null`（既存メッセージとの後方互換性維持）。

### ツールメッセージ（role: 'tool'）の DB 保存方針

Ollama プロトコルでは `role: "tool"` や `role: "assistant"` + `tool_calls` など中間メッセージが発生するが、**これらは DB に個別保存しない**。理由:

- ツールメッセージはエージェントループ内の中間状態であり、ユーザーに直接表示する最終的な「会話」ではない
- DB の `role` フィールドは `'user' | 'assistant'` のみとし、スキーマの後方互換性を維持する
- ツール呼び出しの履歴は assistant メッセージの `metadata.toolCalls` に集約して保存する

これにより、ページリロード後もツール呼び出し履歴が参照可能（metadata から復元表示）でありながら、DB スキーマの変更は最小限に抑えられる。

**制限事項**: ページリロード後に DB から会話を復元した場合、Ollama に送る会話履歴には `role: "tool"` メッセージや `tool_calls` 付き assistant メッセージが含まれない。このため、**エージェント会話の途中から再開することはできない**（新たなターンとして扱われる）。ツール呼び出し履歴の「表示」は可能（`metadata.toolCalls` から復元）だが、「エージェントループの再継続」は不可という制限を実装者は認識すること。

---

## 型定義

### バックエンド型（lib/tools/types.ts）

```typescript
// Ollama API 向けツール定義
export interface OllamaToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
      }>;
      required: string[];
    };
  };
}

// Ollama レスポンスのツール呼び出し
export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

// ツール実行記録
export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  isError: boolean;
  durationMs: number;
}

// クライアント向けストリーミングイベント
export type AgentStreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call_start'; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_call_result'; name: string; result: string; isError: boolean }
  | { type: 'done'; metadata?: { toolCalls: ToolCallRecord[]; agentRounds?: number; agentDurationMs?: number } }
  | { type: 'error'; message: string }
  | { type: 'thinking'; content: string };  // Phase C
```

### フロントエンド型（types/index.ts 拡張）

```typescript
export interface ToolCallInfo {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  isError: boolean;
  durationMs: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  metadata?: {                    // 新規
    toolCalls?: ToolCallInfo[];
    thinkingText?: string;        // Phase C: 思考過程テキスト
    agentRounds?: number;         // Phase C: 実行ラウンド数
    agentDurationMs?: number;     // Phase C: 実行所要時間（ms）
  } | null;
}
```

---

## フロントエンド変更

### Phase A: 基盤

#### useChat フックの拡張

1. **NDJSON パーサー追加**: レスポンスを行単位で読み取り、JSON パースしてイベント型で処理
2. **ツール状態管理**: `activeToolCall: { name: string; arguments: object } | null` を追加
3. **メタデータ蓄積**: ツール呼び出し情報を蓄積し、最終的に Message の metadata に格納
4. **後方互換**: プレーンテキストストリーミング（エージェント無効時）も引き続きサポート

#### ToolCallIndicator コンポーネント

ツール実行中のインジケーター表示:

```
🔧 get_current_datetime を実行中...
```

- スピナーアニメーション付き
- ツール名と引数を表示

#### ToolCallResult コンポーネント

ツール実行結果の折りたたみ表示:

```
✅ get_current_datetime → 2026-04-02T15:30:00+09:00 (5ms)
```

- 結果が長い場合は折りたたみ（クリックで展開）
- エラー時は赤色表示

#### 設定 UI 変更

- 設定モーダルに「エージェント」セクション追加
- エージェントモード ON/OFF トグル

### Phase B: 調査系ツール追加

- ToolCallResult に Web 検索結果のリッチ表示（リンク付き）を追加

### Phase C: 自律エージェント化

#### thinking イベントのソース（実装済み）

`thinking` イベントのテキストは以下の方法で取得する:

1. **`<think>` タグの抽出**（モデル依存）: `qwen3-coder-next:latest` 等の思考モード対応モデルは `<think>...</think>` タグ内に思考過程を出力する場合がある。このタグ内テキストを検出した場合、`thinking` イベントとして送信する

**`<think>` タグのストリーム跨ぎ対応**: トークン単位のストリーミングでは `<think>` / `</think>` が複数チャンクに分割される。`contentBuffer` + `inThinkBlock` による状態マシン方式で正確に検出する。ストリーム終了時に閉じタグが来なかった場合も残バッファを thinking として扱う（不正な LLM 出力への耐性）。

**注意**: `<think>` タグの出力はモデルに依存するため、全モデルで動作するとは限らない。

#### AgentThinking コンポーネント（実装済み）

思考過程をインラインで折りたたみ表示:

- `Brain` アイコン + 「思考過程」ラベル
- デフォルト展開状態、クリックで折りたたみ
- `aria-expanded` + `aria-label` でアクセシビリティ対応
- テキストは `<pre>` タグで等幅フォント表示

#### システムプロンプトのプリセット（`lib/agent-prompts.ts`）

Phase C では `agent-prompts.ts` に4種のプリセットを定義。設定モーダル（Tools ON 時のみ表示）で選択し、localStorage に `agent-prompt-preset-id` として永続化する:

| ID | 名前 | 用途 |
|----|------|------|
| `researcher` | リサーチャー | Web 検索・URL 取得を使った情報収集と整理（デフォルト） |
| `analyst` | 分析者 | 収集した情報の分析・比較・評価 |
| `reviewer` | 比較レビュアー | 複数の選択肢を比較して最適なものを推薦 |
| `none` | なし | システムプロンプトなし |

#### 実行統計の表示

`done` イベントの `agentRounds`・`agentDurationMs` を ChatWindow 下部に小さく表示:

```
3 ラウンド  8.4s
```

---

## 設定

### 環境変数

| 変数名 | 説明 | デフォルト | Phase |
|--------|------|-----------|-------|
| `AGENT_ENABLED` | エージェント機能の有効化 | `true` | A |
| `AGENT_MAX_TOOL_ROUNDS` | ツール呼び出しの最大ラウンド数 | `10` | A |
| `AGENT_TOOL_TIMEOUT_MS` | 各ツール実行のタイムアウト（ms） | `30000` | A |

**設定値の設計意図:**

- **`AGENT_MAX_TOOL_ROUNDS = 10`**: エージェントループの無限実行を防止する安全弁。Phase C の自律エージェントでは1つの質問に対し3〜5ラウンド程度のツール呼び出しが想定される。10ラウンドは十分な余裕を持った上限値。超過時は現時点までの情報で回答を生成するようシステムプロンプトで指示する。
- **`AGENT_TOOL_TIMEOUT_MS = 30000`**: **リトライを含むツール実行全体**のタイムアウト（1試行ごとではない）。`web_search` のリトライ（最大2回 + 待機）を含めた合計時間が30秒を超えた時点でタイムアウトとする。**全体タイムアウト経過時はリトライ中であっても即時中断する。** Web 検索や URL 取得はネットワーク遅延を考慮して30秒に設定。ローカルツール（日時取得、計算）は数ミリ秒で完了するため影響しない。
- **リソース消費への配慮**: エージェントループ（最大10ラウンド × ツール実行）は通常チャットより応答が遅くサーバーリソースを多く消費する。個人利用前提のため同時接続によるリソース枯渇の問題はないが、ユーザーにはエージェントモードが通常チャットより遅い旨を UI 上で示す。

### CI 環境でのエージェントテスト

CI では `qwen2.5:0.5b`（軽量モデル）を使用しているが、このモデルが Tool Calling を正常にサポートするかは未検証である。

**CI テスト方針:**
- Phase A の実装開始時に `qwen2.5:0.5b` での Tool Calling 動作を検証する
- Tool Calling 非対応の場合、以下のいずれかで対応:
  1. Tool Calling 対応の軽量モデルに変更（例: `qwen2.5:1.5b` 等を調査）
  2. エージェント関連の E2E テストを CI ではスキップ（ローカルのみ実行）
  3. ツール呼び出し部分をモックした CI 専用テストを作成
- 検証結果は `docs/08-ci-e2e-bug-report.md` に追記する

---

## エラーハンドリング

| エラー種別 | 対応 | Phase |
|-----------|------|-------|
| ツール実行失敗 | エラーメッセージを `role: "tool"` で Ollama に返送。LLM がエラーを踏まえて回答 | A |
| ツール実行タイムアウト | タイムアウトエラーを tool result として返送 | A |
| 最大ラウンド数超過 | ループを中断し、現時点までの結果でテキスト応答を生成 | A |
| Ollama 接続エラー | 既存のエラーハンドリングと同様（502 レスポンス） | A |
| 不明なツール名 | エラーを tool result として返送（LLM のハルシネーション対策） | A |
| Web 検索失敗 | 検索サービスの接続エラーを tool result として返送 | B |
| SSRF 試行 | プライベート IP アドレスへのリクエストをブロック | B |

---

## セキュリティ考慮事項

- **ツール実行はサーバー側のみ**: クライアントからツールを直接呼び出せない
- **calculate ツール**: 任意コード実行の禁止。手書き再帰下降パーサー（または `mathjs`）を使用し、パーサー自体がセキュリティの主機構となる。正規表現による文字制限はパーサーへの前処理として補助的に使用する（詳細はツール一覧セクション参照）
- **web_search ツール**: レスポンスサイズを制限（3,000文字）
- **url_fetch ツール**: SSRF 防止のため、DNS 解決後の IP アドレスをブロックリストと照合（詳細はツール一覧セクション参照）
- **入力バリデーション**: ツール引数の型チェック・長さ制限
- **ツール結果の表示**: XSS 防止のため、React の標準エスケープ機能のみ使用（プロジェクトの既存セキュリティ方針に準拠）

---

## 技術検証結果（参考）

モデル: `qwen3-coder-next:latest`（79.7B, Q4_K_M）で検証済み。

| 検証項目 | 結果 |
|---------|------|
| 単一ツール呼び出し | OK |
| マルチターン（ツール結果→最終回答） | OK |
| 複数ツール同時呼び出し | OK（1レスポンスで2ツール並列） |
| ストリーミング + tool calling | OK（tool_calls は1チャンクで返却） |
| `role: "tool"` による結果返送 | OK |
| 応答速度 | ツール判断1-2秒、最終回答1-2秒 |

### 設計上の重要ポイント

- ストリーミング時、`tool_calls` は `done: false` のチャンクに一括で含まれる
- assistant メッセージの `tool_calls` も履歴に含めて再送する必要あり
- 並列ツール呼び出し時は `index` フィールドで区別
