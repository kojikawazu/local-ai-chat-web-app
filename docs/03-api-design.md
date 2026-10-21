# API設計書

> 最終更新: 2026-10-22

## 目次

- [内部API（Next.js Route Handlers）](#内部apinextjs-route-handlers)
  - [POST /api/chat](#post-apichat)
  - [GET /api/conversations](#get-apiconversations)
  - [POST /api/conversations](#post-apiconversations)
  - [DELETE /api/conversations/[id]](#delete-apiconversationsid)
  - [GET /api/conversations/[id]/messages](#get-apiconversationsidmessages)
  - [POST /api/conversations/[id]/messages](#post-apiconversationsidmessages)
  - [GET /api/models](#get-apimodels)
  - [GET /api/tools](#get-apitools)
  - [POST /api/conversations/[id]/generate-title](#post-apiconversationsidgenerate-title)
- [外部API（Ollama）](#外部apiollama)
  - [POST /api/chat（Ollama側）](#post-apichatollama側)
  - [GET /api/tags（Ollama側）](#get-apitagsollama側)

## 内部API（Next.js Route Handlers）

### リクエストボディの検証（全 POST 共通）

ボディは `unknown` として読み取り、`front/src/lib/request-body.ts` の検証関数（`parseChatBody` 等）を通してから DB・Ollama へ渡す（#95）。JSON として構文が正しくても API の形に合わない入力は、すべて `{ error: string }` + 400 で返す。

- ボディは JSON オブジェクトであること（`null`・配列・数値・文字列は 400）
- 各フィールドは型を検証する（文字列に数値、真偽値に文字列などは 400）
- 任意フィールドは `undefined` と `null` のどちらも「指定なし」として扱う
- 上限値は `front/src/lib/validation.ts` が正準（`MAX_MESSAGE_LENGTH` / `MAX_ASSISTANT_MESSAGE_LENGTH` / `MAX_TITLE_LENGTH` / `MAX_HISTORY_MESSAGES` / `MAX_SYSTEM_PROMPT_LENGTH`）

### POST /api/chat

チャットメッセージをOllamaに送信し、ストリーミングレスポンスを返す。
`enableTools: true` の場合はエージェントモードとなり、ツール呼び出しを含む NDJSON イベントストリームを返す。

**リクエスト**

```typescript
{
  message: string;
  conversationHistory?: {   // 最大 1,000 件
    role: 'user' | 'assistant';  // system は systemPrompt、tool はサーバー内のエージェントループだけが作る
    content: string;             // user は最大 10,000 文字、assistant は最大 100,000 文字（保存上限と同じ）
  }[];
  model?: string;          // 使用するモデル名（省略時はOLLAMA_MODEL環境変数のデフォルト値）
  enableTools?: boolean;   // true でエージェントモード（ツール呼び出し有効）。デフォルト false
  systemPrompt?: string;   // システムプロンプト（エージェントモード時に先頭挿入）。最大 10,000 文字
}
```

履歴の要素は `role` と `content` だけに詰め直して Ollama へ渡す（`tool_calls` などの余分な項目は送らない）。クライアント（`lib/conversation-history.ts`）は送信前に履歴を上限内に収める（新しい方から 1,000 件、本文は role 別の上限で切り詰め）。

**レスポンス**

- 通常モード（`enableTools: false`）: Content-Type `text/event-stream`。ストリーミングで逐次テキストチャンクを返す。Ollama には `think: false` を送り、思考に対応したモデルにも思考させない（最初の文字までの時間を優先するため。思考過程は返さない）。
- エージェントモード（`enableTools: true`）: Content-Type `application/x-ndjson`。`AgentStreamEvent`（text / tool_call / tool_result / thinking / done / error）を改行区切り JSON で返す。

**停止・切断**: ブラウザが停止・切断すると（応答ストリームの cancel・`request.signal` の abort）、Ollama への接続を切って生成を止める（#8）。エージェントモードでは実行中のツールも中断し、次のラウンドへ進まず、イベントを送らずにストリームを閉じる（`error` は送らない）。停止はエラーとして記録しない。

**エラーレスポンス**

```typescript
{ error: string }
```

| ステータス | 説明 |
|-----------|------|
| 200 | 成功（ストリーミング開始） |
| 400 | リクエスト不正（JSON不正・ボディが非オブジェクト・メッセージ空・10,000文字超・各フィールドの型不正・履歴の件数／role／content 長さ不正・systemPrompt 上限超過） |
| 502 | Ollama接続エラー |
| 499 | Ollama の応答前（モデルの読み込み待ちなど）にブラウザが停止・切断した（本文なし。受け取る相手はいない） |
| 500 | サーバー内部エラー |

---

### GET /api/conversations

会話一覧を取得する。

**レスポンス**

```typescript
{
  conversations: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  }[];
}
```

| ステータス | 説明 |
|-----------|------|
| 200 | 成功 |
| 500 | サーバー内部エラー |

---

### POST /api/conversations

新規会話を作成する。

**リクエスト**

```typescript
{
  title?: string;  // 省略・空文字時は既定タイトル「新しい会話」。最大100文字
}
```

ボディ自体を省略（空の本文）した場合も既定タイトルで作成する。本文があるのに JSON として不正・オブジェクトでない場合は 400（#95 以前は構文エラーを握りつぶして既定タイトルで作成していた）。

**レスポンス**

```typescript
{
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
```

| ステータス | 説明 |
|-----------|------|
| 201 | 作成成功 |
| 400 | リクエスト不正（JSON不正・ボディが非オブジェクト・title が文字列でない・title が100文字超） |
| 500 | サーバー内部エラー |

上限値は `front/src/lib/validation.ts` の `MAX_TITLE_LENGTH` が正準。

---

### DELETE /api/conversations/[id]

会話を削除する（関連メッセージもカスケード削除）。

| ステータス | 説明 |
|-----------|------|
| 200 | 削除成功 |
| 400 | リクエスト不正（無効なUUID） |
| 404 | 会話が見つからない |
| 500 | サーバー内部エラー |

---

### GET /api/conversations/[id]/messages

指定した会話のメッセージ一覧を取得する。

**レスポンス**

```typescript
{
  messages: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
  }[];
}
```

| ステータス | 説明 |
|-----------|------|
| 200 | 成功 |
| 400 | リクエスト不正（無効なUUID） |
| 404 | 会話が見つからない |
| 500 | サーバー内部エラー |

---

### POST /api/conversations/[id]/messages

メッセージを保存する。

**リクエスト**

```typescript
{
  role: 'user' | 'assistant';
  content: string;                          // user は最大10,000文字、assistant は最大100,000文字
  metadata?: Record<string, unknown> | null; // ツール呼び出し情報・思考過程等（任意。JSONオブジェクトのみ）
}
```

**レスポンス**

```typescript
{
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
```

| ステータス | 説明 |
|-----------|------|
| 201 | 保存成功 |
| 400 | リクエスト不正（無効なUUID・JSON不正・ボディが非オブジェクト・role/content 欠落・role 不正・content が文字列でない・content が上限超過（user 10,000 / assistant 100,000 文字）・metadata が非オブジェクト） |
| 404 | 会話が見つからない |
| 500 | サーバー内部エラー |

上限値は `front/src/lib/validation.ts` が正準。user は `MAX_MESSAGE_LENGTH`（`POST /api/chat` と同一の上限をフロント・API 双方で検証する）、assistant は `MAX_ASSISTANT_MESSAGE_LENGTH`（LLM 出力は長さを制御できないため入力上限と分ける）。

メッセージの作成と会話の `updatedAt` 更新は同一トランザクションで行い、片方だけが成功する部分成功を起こさない。

クライアント（`useChat`）は 2xx 以外を保存失敗として扱い、該当メッセージに失敗表示と再試行ボタンを出す。user メッセージの保存に失敗した場合は `POST /api/chat` を呼ばない（再送で保存できてから応答を生成する）。

---

### GET /api/models

Ollamaで利用可能なモデル一覧を取得する。

**レスポンス**

```typescript
{
  models: string[];       // モデル名の配列
  defaultModel: string;   // デフォルトモデル名（環境変数OLLAMA_MODEL）
}
```

| ステータス | 説明 |
|-----------|------|
| 200 | 成功 |
| 502 | Ollama接続エラー |

---

### GET /api/tools

エージェント機能で利用可能なツールの一覧を取得する。

**レスポンス**

```typescript
{
  tools: {
    name: string;         // ツール名（get_current_datetime, calculate, web_search, url_fetch）
    description: string;  // ツールの説明
    enabled: boolean;     // 有効フラグ（現状は常に true）
  }[];
}
```

| ステータス | 説明 |
|-----------|------|
| 200 | 成功 |

---

### POST /api/conversations/[id]/generate-title

最初のメッセージ内容からLLMで会話タイトルを自動生成し、DBを更新する。

**リクエスト**

```typescript
{
  message: string;   // タイトル生成の元となるメッセージ（先頭500文字を使用）
  model?: string;    // 使用するモデル名（省略時はデフォルト）
}
```

**レスポンス**

```typescript
{
  title: string;     // 生成されたタイトル（日本語、20文字以内目安）
}
```

| ステータス | 説明 |
|-----------|------|
| 200 | 生成成功 |
| 400 | リクエスト不正（無効なUUID・JSON不正・ボディが非オブジェクト・空メッセージ・model が文字列でない） |
| 500 | タイトル生成失敗 |

**備考**: Ollama APIに `stream: false` で非ストリーミングリクエストを送信する。生成するトークン数に上限（`options.num_predict: 64`）を付ける。上限が無いと、小さいモデルが指示を外れて本文の依頼に答え続け、数分間 Ollama を占有してチャットを待たせるため（#8）。

---

## 外部API（Ollama）

### POST /api/chat（Ollama側）

**接続先**: `${OLLAMA_BASE_URL}/api/chat`

**リクエスト**

```json
{
  "model": "qwen3.8:27b",
  "messages": [
    { "role": "user", "content": "..." }
  ],
  "stream": true
}
```

**ストリーミングレスポンス（NDJSON）**

```json
{"model":"qwen3.8:27b","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"qwen3.8:27b","message":{"role":"assistant","content":"!"},"done":false}
{"model":"qwen3.8:27b","message":{"role":"assistant","content":""},"done":true}
```

各行がJSONオブジェクト。`done: true` でストリーミング完了。

---

### GET /api/tags（Ollama側）

**接続先**: `${OLLAMA_BASE_URL}/api/tags`

利用可能なモデル一覧を取得する。`/api/models` Route Handlerから呼び出される。

**レスポンス**

```json
{
  "models": [
    { "name": "qwen3.8:27b", "modified_at": "...", "size": 12345678 }
  ]
}
```
