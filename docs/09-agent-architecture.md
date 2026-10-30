# エージェント機能 設計書

> 最終更新: 2026-10-30

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
  - [ローカルのファイルのツール（#148）](#ローカルのファイルのツール148)
- [API 設計変更](#api-設計変更)
  - [POST /api/chat（変更）](#post-apichat変更)
  - [GET /api/tools（新規 — Phase A）](#get-apitools新規--phase-a)
- [DB スキーマ変更](#db-スキーマ変更)
  - [Message モデルの拡張（Phase A）](#message-モデルの拡張phase-a)
  - [metadata フィールドの構造](#metadata-フィールドの構造)
  - [ツールメッセージ（role: 'tool'）の DB 保存方針](#ツールメッセージrole-toolの-db-保存方針)
- [型定義](#型定義)
  - [バックエンド型（lib/agent/tools/types.ts）](#バックエンド型libagenttoolstypests)
  - [フロントエンド型（types/agent/tool-call.ts・types/chat/message.ts）](#フロントエンド型typesagenttool-callts・typeschatmessagets)
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
    - [システムプロンプトのプリセット（`lib/agent/agent-prompts.ts`）](#システムプロンプトのプリセットlibagentagent-promptsts)
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
  "model": "qwen3.8:27b",
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

上記は `qwen3-coder-next:latest` での観測。`qwen3.8:27b` では tool_calls が **1 件ずつ別チャンク**（`id` 付き）で届き、思考過程は `message.thinking` で返る（#111・#116）。`readOllamaResponse` はチャンクごとに tool_calls を収集するため、どちらの返し方でも動作する。

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
        send done → return

# 上限に達してもツール呼び出しが続いた場合（#96）
stream notice「ツール呼び出しの上限（N 回）に達したため…」 to client
append user instruction「これまでのツール実行結果だけを使って回答して」 to messages
response = ollama.chat(messages, tools=なし, stream=true)   # ツールを渡さないのでテキストで答えるしかない
stream text response to client（失敗・空なら「最終回答の生成に失敗しました」を流す）
send done（toolCalls と agentRounds = N + 1）
```

**停止・切断（#8）**: `runAgentLoop` は、Route Handler の `request.signal` と自身のストリームの cancel をまとめた中断の信号（`AbortSignal.any`）を持つ。この信号を Ollama への `fetch`（`streamChat` の `signal`）と各ツール（ツールごとのタイムアウトの信号と合成）に渡し、abort されたら次の点を守る。

- 実行中の問い合わせ・ツールを中断し、次のラウンドへ進まない（ツール実行の後にも中断を確認する）
- 以降はイベントを書き込まず（`send` が中断後は何もしない）、`error` も送らずにストリームを閉じる。クライアントは `error` を受けると作成中の応答を破棄するため、停止までの本文を残せなくなる
- 閉じたストリームへの `enqueue` は例外になる。以前はこれを `readOllamaResponse` の JSON 解析の `catch` が握りつぶし、ツール実行は `allSettled` が吸収していたため、接続が切れてもループが最後まで回り続けていた

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
{"type":"tool_call_start","name":"web_search","arguments":{"query":"Rust async"},"contentOffset":8}
{"type":"tool_call_result","name":"web_search","result":"...検索結果...","isError":false,"summary":"5 件"}
{"type":"text_delta","content":"\n\n"}
{"type":"text_delta","content":"Rustの非同期処理は..."}
{"type":"done","metadata":{"toolCalls":[...]}}
```

### イベント型一覧

| type | フィールド | 説明 | Phase |
|------|-----------|------|-------|
| `text_delta` | `content: string` | テキスト差分（1チャンク分） | A |
| `tool_call_start` | `name: string`, `arguments: object`, `contentOffset: number` | ツール呼び出し開始。`contentOffset` はその時点で送った本文の文字数（#186） | A |
| `tool_call_result` | `name: string`, `result: string`, `isError: boolean`, `summary?: string`, `isEmpty?: boolean`, `approval?: 'approved' \| 'rejected' \| 'expired'` | ツール実行結果（`summary` は見出しの要約、`isEmpty` は成功だが結果が空。#150。`approval` は承認が要るツールの承認の結果。#148 Phase A2） | A |
| `tool_approval_request` | `approvalId: string`, `name: string`, `preview: ApprovalPreview` | 承認が要るツールの実行前に、見せる内容を送って利用者の許可を待つ。`preview` は `action` で形が決まる（`create` / `overwrite` / `edit` はファイルの差分、`run` はコマンド・実行ファイル・作業フォルダ・時間の上限、`github-comment`・`github-create-pr` はリポジトリと公開か・送る本文）（#148 Phase A2・B・C。`docs/15-tool-approval.md`・`docs/16-command-execution.md`・`docs/17-github-tools.md`） | A2 |
| `done` | `metadata?: { toolCalls: ToolCallInfo[]; agentRounds?: number; agentDurationMs?: number }` | ストリーミング完了（実行統計付き） | A/C |
| `error` | `message: string` | エラー発生 | A |
| `thinking` | `content: string` | エージェントの思考過程 | C |

### 本文の位置とラウンドの区切り（#186）

ツールを何度も呼ぶ応答で、回答がツールの結果の一覧より上に出て画面の外へ押し出されないよう、本文とツールの結果を呼んだ順に並べて表示する。

- **位置はサーバーが数える**: エージェントループは送った本文（`text_delta`）の文字数を数え、ツールを呼んだ時点の値を `tool_call_start` と `ToolCallInfo` の `contentOffset` に付ける（`done` の metadata を通して保存される）。画面は `text_delta` をそのままつなぐため、位置は生成中も保存後も一致する。
- **ラウンドの区切り**: ツールを呼んだ後のラウンドで本文が届き始めたら、先に空行を `text_delta` として送る（`roundSeparator`。それまでに本文が無ければ送らない。区切りも文字数に数える）。ツールの前の一言と次の文がくっつかない。
- **表示**: `buildAgentTimeline`（`lib/chat/agent-timeline.ts`）が本文を `contentOffset` で区切り、`ChatWindow` が「思考過程 → 説明（小さく薄い文字）とツールの結果を呼んだ順に（`AgentSteps`）→ 回答の吹き出し」の順に並べる。`contentOffset` を持たない #186 より前の応答は、従来の「吹き出し → 思考過程 → ツールの一覧」のまま。

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
  execute: (args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolExecution>;
}

// ツールの実行結果（#150）
type ToolOutput = {
  result: string;     // モデルへ返す文章。失敗は "エラー: <理由>"
  isError: boolean;   // 失敗なら true（画面に ❌）
  summary?: string;   // 結果パネルの見出しに出す要約
  isEmpty?: boolean;  // 成功だが結果が空（画面に ⚠️）
};

// ToolOutput に、エージェントループだけが読む印を足したもの（#157）
type ToolExecution = ToolOutput & {
  unavailable?: boolean; // 接続先ごと使えない失敗なら true。同じ応答の中では再び実行しない
};
```

**失敗は例外ではなく `isError: true` で返す（#150）。** モデルは `result` の文章で失敗を理解し、画面は `isError` で成否を出す。失敗の結果は `lib/agent/tools/output.ts` の `toolError(理由)` で作る（文章は `"エラー: <理由>"`、要約は理由）。`runTool` が `isError: true` にするのは例外（タイムアウト・未登録のツール）だけで、このときも理由を要約にする。成否を文章の先頭（`エラー: `）で判定しないのは、取得したページの本文がたまたまそう始まるだけで失敗と誤判定するため。

| ツール | 要約（成功） | 空の結果（`isEmpty`） | 失敗（`isError`） |
|---|---|---|---|
| `web_search` | `5 件` | `0 件`（すべての検索エンジンが応答したうえでの 0 件） | 理由（応答しない検索エンジン・未起動・403 等） |
| `url_fetch` | `3,214 文字` / `12,345 文字（5,000 文字に省略）` | `本文なし` | 理由（SSRF・HTTP エラー・サイズ超過等） |
| `calculate` | `= 14` | — | 理由（ゼロ除算・不正な文字等） |
| `get_current_datetime` | 取得した日時 | — | —（不正なタイムゾーンは UTC で返す） |

**接続先ごと使えない失敗は、同じ応答の中で再び実行しない（#157）。** 入力に関係なく起きる失敗（SearXNG の停止・すべての検索エンジンの無応答・403・リトライし尽くした 5xx / 429 等）は、`toolUnavailable(理由)` で `unavailable: true` を付けて返す。エージェントループはツール名ごとにこれを覚え、同じ応答の中で再び呼ばれたら実行せずに次を返す。

- モデルへ: `エラー: <ツール名> は、この応答の中で先に使えないとわかったため実行しませんでした（<先の理由>）。この応答ではこのツールを呼ばず、ここまでの情報で回答してください。`
- 見出しの要約: `実行しませんでした（先の呼び出しで使えないとわかったため）`。所要時間は 0ms。呼び出しは記録に残す（❌ で表示・保存する）

文章で「検索し直さないで」と伝えるだけでは、モデルは言い換えて呼び直し続ける（2026-10-24 に、検索エンジンがすべて止められた状態で 1 回の応答に 7 回以上検索した）。止められている接続先へのアクセスを増やし、止められる時間を延ばすため、ループで止める。`unavailable` はループが取り除いてから画面・DB へ送る。入力ごとに成否が変わる失敗（`url_fetch` の取得できない URL 等）には付けない。

結果パネル（`ToolCallResult`）の見出しは、失敗 ❌・空の結果 ⚠️・それ以外 ✅ のアイコンに要約を添える。失敗の理由は赤字の 1 行に収め、全文はツールチップ（`title`）で見せる。要約は `tool_call_result` と `done` の `toolCalls` に載り、そのまま metadata に保存されるため、会話を開き直しても同じ見出しになる。

結果が届く前（生成中）の記録は、画面だけが状態（`status`: `running` / `awaiting-approval`）を持ち、成否のアイコンの代わりにスピナー「実行中…」・⏳「承認待ち」を出す（#192。承認カードを出している間に ✅ に見えないように）。`tool_call_start` で仮の記録を足し、`tool_approval_request` で承認待ちに、許可・拒否を返したら実行中に戻し、`tool_call_result` で状態を消して結果に置き換える（`lib/chat/tool-call-progress.ts`）。サーバーは状態を付けず、保存する記録（サーバーから届いた結果）も持たない。

### ツールレジストリ

```typescript
// lib/agent/tools/index.ts
const toolRegistry: Map<string, Tool> = new Map();

function registerTool(tool: Tool): void;
function getTool(name: string): Tool | undefined;
function getAllToolDefinitions(): OllamaToolDefinition[];
function executeTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolExecution>;
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
| 戻り値 | 検索結果のタイトル・URL・スニペット一覧（`[N] タイトル / URL: ... / 概要` 形式のテキスト。UI の `WebSearchResult` がこの形を読む） |
| 実装 | ローカルの **SearXNG** の JSON API（`GET {SEARXNG_URL}/search?q=...&format=json&language=auto`）。下記「検索エンジン選定」を参照 |
| 接続先 | 環境変数 `SEARXNG_URL`（既定 `http://localhost:8888`。`docker-compose.yml` の `searxng` サービス） |
| 制限 | 結果を上位5件に制限、レスポンスを3,000文字以内にトリム。受信は本文を**ストリームで読み 1 MiB（バイト）で打ち切る** |
| タイムアウト | 1 試行 10 秒。**ヘッダー受信から本文の読了まで**に適用（リトライ時は試行ごとに新しい期限） |
| リトライ | 条件に応じてリトライ（下記「リトライ条件」参照） |

**検索エンジン選定:**

| 候補 | メリット | デメリット |
|------|---------|-----------|
| DuckDuckGo HTML スクレイピング（旧実装） | API キー不要、手軽 | 非公式 API のため仕様変更・ブロックのリスクあり。**2026-10-23 にボット判定で全検索が拒否された** |
| **SearXNG（セルフホスト・採用）** | ローカル環境方針に合致。安定した JSON API。複数検索エンジンを集約し、1 つがブロックされても結果を返せる | Docker Compose への追加が必要（メモリ約 150MiB） |
| Brave Search API | 公式 API、無料枠あり | API キー必要。外部依存 |

**採用: SearXNG**（#151）。初期実装は DuckDuckGo の HTML スクレイピングだったが、2026-10-23 に DuckDuckGo がすべての検索にボット判定の確認ページ（HTTP 202）を返し、検索結果を取得できなくなった（ブラウザの User-Agent・POST・lite 版でも同じ）。ツールは確認ページを 0 件と誤認し、モデルが言い換えた検索を 1 回の応答で最大 17 回繰り返していた。SearXNG に切り替え、DuckDuckGo への直接の問い合わせは削除した。

- 同じ時点で SearXNG 経由の検索は 20〜27 件を 0.7〜1.8 秒で返した。DuckDuckGo（CAPTCHA）・Brave（too many requests）が応答しなくても、Google CSE 等の結果で補えた。
- **SearXNG の構成**（`docker-compose.yml` の `searxng` サービス・`searxng/settings.yml`）:
  - イメージはタグで固定する（`searxng/searxng:2026.10.2-a5659a536`）。
  - `127.0.0.1:8888` だけで待ち受ける（同時アクセスの制限 `limiter` を止めているため、PC の外へ公開しない）。
  - `search.formats` に `json` を加える（既定は `html` だけで、`format=json` は 403 になる）。
  - **Web 検索のエンジンを足す（#157）**。既定で有効な Web 検索エンジンは Brave・DuckDuckGo（html 版）・Google CSE の 3 つだけで、2026-10-24 に 3 つとも止められた（Brave・Google CSE は too many requests で 180 秒の停止を繰り返し、DuckDuckGo の html 版は毎回 CAPTCHA）。日本語・英語のクエリで結果を返した Yahoo・`duckduckgo web`（duckduckgo.com を使う版）・Bing を有効にした。Bing は単独では関係の薄い結果も返すが、複数のエンジンが共通して返した結果が上位に並ぶため補助として使う。
  - **DuckDuckGo の html 版（`duckduckgo`）は無効にする**。毎回 CAPTCHA で応答せず、応答しないエンジンが残ると、他のエンジンの 0 件を「検索エンジンが応答しなかった」失敗として扱うことになるため。
  - `server.secret_key` が既定値のままだと起動しないため、`SEARXNG_SECRET` が空なら**起動ごとにランダムな鍵を作る**（Cookie 等の署名にしか使わず、ローカルでは起動ごとに変わっても困らない。リポジトリにも `.env` にも秘密を置かない）。

**0 件と失敗の区別**: SearXNG の応答の `unresponsive_engines`（応答しなかった検索エンジンと理由）を見る。結果が 0 件で応答しなかった検索エンジンがあれば、0 件ではなく失敗（エンジン名つき）として返す。すべて応答したうえでの 0 件だけを「見つかりませんでした」とする（0 件と伝えるとモデルは言い換えた再検索を繰り返すため）。失敗の文章では、この応答の中で検索し直さず、検索できなかったことを伝えたうえで回答するよう求める（「時間をおいて検索し直して」と伝えると、モデルは待たずに言い換えて検索し続けたため。#157）。ツールの失敗は空のクエリ以外すべて `unavailable` として返し、同じ応答の中では再び実行しない。

**リトライ条件**:

| 状況 | リトライ | 理由 |
|------|---------|------|
| ネットワークエラー・接続タイムアウト | ✅ 最大2回（1秒間隔） | 一時的な障害の可能性 |
| HTTP 5xx（サーバーエラー） | ✅ 最大2回（1秒間隔） | サービス一時障害の可能性 |
| HTTP 429（レートリミット） | ✅ 最大2回（Exponential Backoff: 2秒 → 4秒） | 時間を置けば回復する可能性 |
| 接続の拒否（`ECONNREFUSED`。SearXNG が起動していない） | ❌ リトライしない。`docker compose up -d` で起動するよう伝える | 起動するまで変わらない |
| HTTP 403（JSON の API が無効） | ❌ リトライしない。`searxng/settings.yml` の `search.formats` を確かめるよう伝える | 設定の誤りのため |
| HTTP 4xx（Bad Request 等） | ❌ リトライしない | クエリや設定の問題のためリトライしても無意味 |
| 応答の形が違う（JSON でない・`results` が無い） | ❌ リトライしない | リトライしても同じ結果になる |

#### 4. url_fetch（URL取得）

| 項目 | 内容 |
|------|------|
| 名前 | `url_fetch` |
| 説明 | 指定 URL のコンテンツを取得する |
| パラメータ | `url` (string, required) — 取得対象の URL |
| 戻り値 | ページのテキストコンテンツ（HTML タグ除去済み） |
| 制限 | レスポンスを5,000文字以内にトリム。受信は本文を**ストリームで読み 2 MiB（バイト）で打ち切る**。`Content-Length` は早期拒否の補助で、宣言が無い・偽っている場合も実受信量で止める |
| タイムアウト | 15 秒。**ヘッダー受信から本文の読了まで**に適用 |
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

### ローカルのファイルのツール（#148）

ローカル PC のファイルを読むツール。設計の詳細（脅威・上限・判定の順序）は [14-local-file-tools.md](./14-local-file-tools.md)。実装は `lib/agent/tools/local-files/`。

| ツール | 引数 | 返すもの |
|---|---|---|
| `list_directory` | `path` | フォルダの直下の一覧（フォルダ → ファイル → リンク。ファイルはバイト数付き。最大 200 件） |
| `search_files` | `query`・`path`・`target`（`name` / `content`） | ファイル名（`*`・`?` のワイルドカードか部分一致）か中身（文字列の部分一致・行番号付き）で見つかったもの。最大 30 件 |
| `read_file` | `path`・`start_line`・`end_line` | 行番号付きの本文。1 回 300 行・12,000 文字まで（続きは `start_line` で読む） |

- **既定では使えない**: 環境変数 `LOCAL_FILE_ROOTS`（読んでよいフォルダ）を設定したときだけ登録する（`registry.ts`）。
- **パスの判定**: `realpath` で実体のパスにしてから、許可したフォルダの中にあるかを `path.relative` で判定する。検索ではシンボリックリンクをたどらない。
- **秘匿ファイル**: `.env`・鍵・認証情報のファイルと `.ssh`・`.aws` などのフォルダは、一覧・検索に出さず読み取りも断る（範囲は CI の Secret scan と同じ）。
- **外部への持ち出しの抑止**: ツールに `access`（`local` / `network`）の印を付け、同じ応答の中で `local` のツールが成功した後は、`network` のツール（`web_search`・`url_fetch`）を実行せずに理由を返す（`agent.ts` の `shouldBlockTool`）。`local` は「利用者の手元の情報を読む」の意味で、コマンドの実行（Phase B）と GitHub を読むツール（Phase C）にも付ける。
- 書き込み（`write_file`・`edit_file`）と実行前の承認は Phase A2（[15-tool-approval.md](./15-tool-approval.md)）。`prepare` を持つツールは、ループが準備 → `tool_approval_request` → 承認の API（`POST /api/agent/approvals/[id]`）の結果を待つ → 実行の順に進める（`runWithApproval`）。
- コマンドの実行（`run_command`）は Phase B（[16-command-execution.md](./16-command-execution.md)）。`LOCAL_COMMANDS` のプログラムだけを、`LOCAL_FILE_WRITE_ROOTS` の中を作業フォルダにして、シェルを介さずに実行する（実行前に承認が要る）。実行の時間の上限はツールが持つ `runTimeoutMs`（`LOCAL_COMMAND_TIMEOUT_MS` + 10 秒）で、ツール全般の `AGENT_TOOL_TIMEOUT_MS` より長い。`access` は `local` で、ファイルを読んだ後でも止めず、成功した後はその応答で `network` のツールを止める。
- GitHub のツールは Phase C（[17-github-tools.md](./17-github-tools.md)）。`GITHUB_REPOS` のリポジトリだけを扱い、`gh` の引数はアプリが組み立てる（`lib/agent/tools/github/`）。読む `github_list`（PR・issue の一覧）・`github_view`（詳細。PR なら変更したファイル・CI・レビューも）・`github_pr_diff`（PR の差分。`file` で絞る）は承認なしで、`access` は `local`（非公開のリポジトリの内容を読むため、成功した後はその応答で `network` のツールを止める）。`github_comment`・`github_create_pr` は `prepare` を持ち、承認カードに送る本文を出してから送る（`access` は付けない。ファイルを読んだ後でも止めない）。`gh` の起動は `run_command` の `runProcess`（標準出力を別に受ける `stdout` を足した）を使い回す。
- ブラウザのツールは #149（[18-browser-tools.md](./18-browser-tools.md)）。`BROWSER_ENABLED=true` のときだけ登録する（`lib/agent/tools/browser/`）。`browser_navigate`（開いてアクセシビリティツリーを返す）・`browser_snapshot`（読み直す・`offset` で続きを読む。1 回 12,000 文字）・`browser_screenshot`（見えている範囲の PNG をモデルへ画像で渡す）。Chromium の通信はアプリの中のプロキシで接続ごとに宛先を判定する。
  - **応答ごとの文脈（`ToolContext`）**: ループは応答ごとに `appOrigin`（`/api/chat` のオリジン）・`scope`（応答ごとに 1 つ作るものの置き場）・`onDispose`（応答の終わりの後始末）・`hasReadLocal` を作り、`execute` の 3 つ目の引数で渡す。ブラウザのセッションは `scope` に置き、応答が終わる（完了・エラー・停止）とループが閉じる。
  - **呼び出しごとの `access`**: `access` に引数から決める関数も書ける（`resolveAccess`）。`browser_navigate` は開く URL が `BROWSER_LOCAL_ORIGINS` なら `local`、それ以外は `network`。実行の後で手元の情報を読んだと分かったとき（手元のページを読み直した・撮った）は、結果の `readLocal` でループに知らせる。公開のページ（その中のスクリプト・iframe・転送）からは、プロキシが手元の開発サーバーへ接続させない（最上位のページが手元のときだけ通す）。
  - **画像のツール**: `requiresVision` のツール（`browser_screenshot`）は、ループの最初にモデルの対応機能（`supportsVision`）を確かめ、画像を読めなければツールの一覧から外す（呼ばれても実行しない）。結果の `images` は `role: 'tool'` のメッセージの `images` に入れ、画面・DB へは送らない。画像を渡せないのに「撮った」とだけ返すと、モデルは見たふりをして答えるため（`docs/18-browser-tools.md`「前提の調査」）。

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
- **追記（#10）**: 会話の役割（システムプロンプト）の導入で、`systemPrompt` は通常モードでも先頭に付けるようになった。エージェントモードでは、クライアントが会話の役割を先に、下記のプリセットを後に置いて連結したものを送る（`lib/chat/system-prompt.ts` の `buildSystemPrompt`。詳細は `03-api-design.md`）
- **追記（#154）**: サーバーは `systemPrompt` の後ろに「現在の日時」の節を必ず足す（`lib/llm/current-date.ts` の `withCurrentDate`）。`systemPrompt` が空でも日時の節だけの system メッセージを付ける
  - 理由: モデルは学習した時点を「今」と思い込む。日時を知らせないと、「最新」を聞かれたとき最初の検索で古い年を使い（「PHP latest stable version 2025」等）、`get_current_datetime` はその後で呼ばれていた。プリセットなしでは古い記事を根拠に古い版を最新と答えた（2026-10-24、qwen3.8:27b）
  - 節の中身: 日付・曜日・時刻・タイムゾーン（サーバーのもの。localhost で使うためブラウザと同じ）・UTC との差と、「最新」「今年」「現在」をこの日時で解釈する指示。エージェントモードでは「検索語の年はこの年を使う」「知識と検索結果が食い違えば新しい検索結果を優先する」、通常モードでは「検索できないため、この日時の時点の情報として断定せず、学習時点の知識だと前置きする」を足す
  - 別の system メッセージにせず、先頭の 1 つにまとめる（会話の途中の system はテンプレートによって無視・破損されるため。最大ラウンド到達時の指示を user で足すのと同じ理由）
  - `get_current_datetime` は残す（長い会話で時刻が要る場合や、別のタイムゾーンの時刻を聞かれた場合のため）

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
      "summary": "2026-04-02T15:30:00+09:00",
      "durationMs": 5
    },
    {
      "name": "web_search",
      "arguments": { "query": "天気 東京" },
      "result": "\"天気 東京\" の検索結果 (上位5件):\n...",
      "isError": false,
      "summary": "5 件",
      "durationMs": 1200
    }
  ]
}
```

エージェント応答では、ツール呼び出しに加えて思考過程と実行統計も保存する（#94）:

```json
{
  "toolCalls": [ ... ],
  "thinkingText": "時刻を調べる\n\n取得した時刻を伝える",
  "agentRounds": 2,
  "agentDurationMs": 14800
}
```

- 値のある項目だけを保存する。ツールを使わず思考だけした応答でも、`thinkingText`・`agentRounds`・`agentDurationMs` は残る。値のある項目が 1 つも無い場合（通常チャットの応答）は `metadata` は `null`
- 表示用の state と保存する値は、同じ関数（`lib/chat/message-metadata.ts` の `buildMessageMetadata`）で組み立てる。片方だけ項目が欠けて、再読み込みで表示が消えるのを防ぐ
- 取得時は `parseMessageMetadata` で項目ごとに実行時検証し、型が合わない項目だけを捨てる（DB の JSON 列は任意の値を持てるため）。ツール呼び出しは名前と結果が文字列なら復元し、欠けた項目は既定値で補う
- **本文が空の応答は保存されない**（保存 API が `content` を必須とするため）。ツール呼び出し後にモデルが最終回答の本文を返さなかった場合、付随情報ごと再読み込みで消える

### ツールメッセージ（role: 'tool'）の DB 保存方針

Ollama プロトコルでは `role: "tool"` や `role: "assistant"` + `tool_calls` など中間メッセージが発生するが、**これらは DB に個別保存しない**。理由:

- ツールメッセージはエージェントループ内の中間状態であり、ユーザーに直接表示する最終的な「会話」ではない
- DB の `role` フィールドは `'user' | 'assistant'` のみとし、スキーマの後方互換性を維持する
- ツール呼び出しの履歴は assistant メッセージの `metadata.toolCalls` に集約して保存する

これにより、ページリロード後もツール呼び出し履歴が参照可能（metadata から復元表示）でありながら、DB スキーマの変更は最小限に抑えられる。

**制限事項**: ページリロード後に DB から会話を復元した場合、Ollama に送る会話履歴には `role: "tool"` メッセージや `tool_calls` 付き assistant メッセージが含まれない。このため、**エージェント会話の途中から再開することはできない**（新たなターンとして扱われる）。ツール呼び出し履歴・思考過程・実行統計の「表示」は可能（`metadata` から復元）だが、「エージェントループの再継続」は不可という制限を実装者は認識すること。

---

## 型定義

### バックエンド型（lib/agent/tools/types.ts）

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

// ツールの実行結果（#150）。ツール実行記録は types/agent/tool-call.ts の ToolCallInfo に一本化した
export type ToolOutput = Pick<ToolCallInfo, 'result' | 'isError' | 'summary' | 'isEmpty'>;

// ツールが返す値。ループだけが読む印（接続先ごと使えない）を足す（#157）
export type ToolExecution = ToolOutput & { unavailable?: boolean };

// クライアント向けストリーミングイベント
export type AgentStreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call_start'; name: string; arguments: Record<string, unknown>; contentOffset: number }
  | ({ type: 'tool_call_result'; name: string } & ToolOutput)
  | { type: 'done'; metadata?: { toolCalls: ToolCallInfo[]; agentRounds?: number; agentDurationMs?: number } }
  | { type: 'error'; message: string }
  | { type: 'thinking'; content: string };  // Phase C
```

### フロントエンド型（types/agent/tool-call.ts・types/chat/message.ts）

```typescript
// types/agent/tool-call.ts
export type ToolCallInfo = {
  name: string;
  arguments: Record<string, unknown>;
  result: string;          // モデルへ返した文章
  isError: boolean;
  summary?: string;        // 見出しの要約（#150。古いデータは持たない）
  isEmpty?: boolean;       // 成功だが結果が空（#150）
  durationMs: number;
};

// types/chat/message.ts
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

1. **`<think>` タグの抽出**（モデル依存）: `qwen3` 系など、本文中の `<think>...</think>` タグ内に思考過程を出力するモデルがある。このタグ内テキストを検出した場合、`thinking` イベントとして送信する
2. **`message.thinking` フィールド**（#116）: `qwen3.8` 等の思考対応モデルは、Ollama のチャンクで本文（`message.content`）とは別の `message.thinking` に思考過程を返す。1 回の応答の間ためておき、本文かツール呼び出しが届いた時点（またはストリームの終わり）で 1 つの `thinking` イベントにまとめて送信する

**`<think>` タグのストリーム跨ぎ対応**: トークン単位のストリーミングでは `<think>` / `</think>` が複数チャンクに分割される。`contentBuffer` + `inThinkBlock` による状態マシン方式で正確に検出する。ストリーム終了時に閉じタグが来なかった場合も残バッファを thinking として扱う（不正な LLM 出力への耐性）。

**`message.thinking` をまとめて送る理由**: 断片はトークン単位（`' user'` のように先頭に空白を持つ）で届き、`thinking` イベントは送信前に `trim()` される。断片ごとに送ると単語間の空白が消えるため、`<think>` タグと同じくブロック単位にそろえる。そのぶん思考中は思考過程が表示されず、最初のチャンク待ちの表示が続く。

**ラウンドごとの思考過程**: `thinking` イベントはブロック（ラウンド）ごとに届く。クライアント（`useChat`）は空行で区切って連結し、`AgentThinking` に 1 つの思考過程として表示する。

**思考の有無（`think` パラメータ）**: エージェントモードでは `think` を送らず、モデルの既定（思考する）に任せる。通常チャットとタイトル生成は `think: false` で思考を止める（通常チャットは最初の文字までの時間を優先するため。`qwen3.8:27b` で約 5.7 秒 → 約 0.4 秒）。思考に対応していないモデルに `think: false` を送っても Ollama はエラーにしない（`true` はエラーになる）。

**注意**: 思考過程を返すかどうかはモデルに依存するため、全モデルで表示されるとは限らない。

#### AgentThinking コンポーネント（実装済み）

思考過程をインラインで折りたたみ表示:

- `Brain` アイコン + 「思考過程」ラベル
- デフォルト展開状態、クリックで折りたたみ
- `aria-expanded` + `aria-label` でアクセシビリティ対応
- テキストは `<pre>` タグで等幅フォント表示

#### システムプロンプトのプリセット（`lib/agent/agent-prompts.ts`）

Phase C では `agent-prompts.ts` に4種のプリセットを定義。設定モーダル（Tools ON 時のみ表示）で選択し、localStorage に `agent-prompt-preset-id` として永続化する。会話の役割（#10）とは別物で、役割が「誰として答えるか」、このプリセットが「どう調べて答えるか」を担い、送信時に役割の後ろへ連結する:

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
| `SEARXNG_URL` | `web_search` が問い合わせる SearXNG の接続先 | `http://localhost:8888` | B |

**設定値の設計意図:**

- **`AGENT_MAX_TOOL_ROUNDS = 10`**: エージェントループの無限実行を防止する安全弁。Phase C の自律エージェントでは1つの質問に対し3〜5ラウンド程度のツール呼び出しが想定される。10ラウンドは十分な余裕を持った上限値。上限に達してもツール呼び出しが続く場合は、**ツールを渡さずにもう 1 回問い合わせ**、取得済みのツール結果で最終回答を生成させる（指示は会話途中の system ではなく user の発言として末尾に付ける。テンプレートによって途中の system が無視・破損されるため）。本文の先頭には上限到達の注記を流し、本文の一部として表示・保存する。最終回答の問い合わせ自体が失敗した・空だった場合も `error` にはせず、失敗した旨を本文に流して `done` で閉じる（`error` を受けたクライアントは作成中のメッセージを破棄し、取得済みのツール結果まで失われるため）。`agentRounds` は Ollama への問い合わせ回数として数えるため、上限到達時は `上限 + 1` になる（#96）。
- **`AGENT_TOOL_TIMEOUT_MS = 30000`**: **リトライを含むツール実行全体**のタイムアウト（1試行ごとではない）。`web_search` のリトライ（最大2回 + 待機）を含めた合計時間が30秒を超えた時点でタイムアウトとする。**全体タイムアウト経過時はリトライ中であっても即時中断する。** 中断は `runTool()` が `AbortSignal` をツールへ渡して abort することで実現する（`Tool.execute(args, signal)`）。ツールは signal を fetch・本文読み取り・リトライ待機へ伝播するため、タイムアウト後に通信がバックグラウンドで残らない。signal を見ないツールに備え、応答自体は `Promise.race` でも打ち切る。 Web 検索や URL 取得はネットワーク遅延を考慮して30秒に設定。ローカルツール（日時取得、計算）は数ミリ秒で完了するため影響しない。
- **値の検証**（`lib/agent/agent-config.ts` の `parsePositiveIntEnv`）: 両変数とも符号なしの 10 進整数だけを受け付け、`AGENT_MAX_TOOL_ROUNDS` は 1〜50、`AGENT_TOOL_TIMEOUT_MS` は 1〜300000（5 分）の範囲とする。未設定・空文字は既定値を使う。数値でない値・0・負数・小数・`10abc` のような末尾に文字を含む値・範囲外は既定値に戻し、`console.warn` で知らせる（`parseInt` のままだと `NaN` や 0 でループが 1 回も回らず、安全弁が誤設定で無効になるため）。
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
| 最大ラウンド数超過 | ループを中断し、ツールを渡さない問い合わせで現時点までの結果からテキスト応答を生成（上限到達の注記付き）。その生成が失敗しても `error` にせず、失敗を本文で伝えてツール結果を残す（#96） | A |
| Ollama 接続エラー | 既存のエラーハンドリングと同様（502 レスポンス） | A |
| 不明なツール名 | エラーを tool result として返送（LLM のハルシネーション対策） | A |
| Web 検索失敗 | 検索サービスの接続エラーを tool result として返送 | B |
| SSRF 試行 | プライベート IP アドレスへのリクエストをブロック | B |

---

## セキュリティ考慮事項

- **ツール実行はサーバー側のみ**: クライアントからツールを直接呼び出せない
- **calculate ツール**: 任意コード実行の禁止。手書き再帰下降パーサー（または `mathjs`）を使用し、パーサー自体がセキュリティの主機構となる。正規表現による文字制限はパーサーへの前処理として補助的に使用する（詳細はツール一覧セクション参照）
- **web_search ツール**: レスポンスサイズを制限（3,000文字）。受信本文は 1 MiB で打ち切る
- **外部取得の受信制限（web_search / url_fetch 共通）**: 本文は `lib/agent/tools/read-body.ts` の `readBodyWithLimit()` でストリーム読み取りし、受信バイト数が上限を超えた時点・signal が中断された時点で reader を cancel する。`res.text()` で本文全体をバッファしない（巨大な chunked 応答・終端しない slow response によるメモリ枯渇とプロセス占有の防止）
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

モデル: `qwen3.8:27b`（現在の既定。Ollama 0.40.5）で検証済み（#111）。

| 検証項目 | 結果 |
|---------|------|
| 単一ツール呼び出し・マルチターン | OK（2 ラウンドで最終回答） |
| ストリーミング + tool calling | OK（tool_calls は 1 件ずつ別チャンク・`id` 付き） |
| 思考過程 | `message.thinking` で返る（エージェントは thinking イベントとして表示。#116） |
| 読み込み時のメモリ | 約 17GB（`qwen3-coder-next` は約 58GB） |
| 応答速度 | 通常チャット（`think: false`）は最初の文字まで約 0.4 秒。エージェントは思考込みで 1 ラウンド数秒 |
| E2E（`E2E_OLLAMA_MODEL=qwen3.8:27b`） | エージェント系・ストリーミング系 37 件成功（#115） |

### 設計上の重要ポイント

- ストリーミング時、`tool_calls` は `done: false` のチャンクに一括で含まれる
- assistant メッセージの `tool_calls` も履歴に含めて再送する必要あり
- 並列ツール呼び出し時は `index` フィールドで区別
