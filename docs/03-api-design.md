# API設計書

> 最終更新: 2026-06-11

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

### POST /api/chat

チャットメッセージをOllamaに送信し、ストリーミングレスポンスを返す。
`enableTools: true` の場合はエージェントモードとなり、ツール呼び出しを含む NDJSON イベントストリームを返す。

**リクエスト**

```typescript
{
  message: string;
  conversationHistory?: {
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
  }[];
  model?: string;          // 使用するモデル名（省略時はOLLAMA_MODEL環境変数のデフォルト値）
  enableTools?: boolean;   // true でエージェントモード（ツール呼び出し有効）。デフォルト false
  systemPrompt?: string;   // システムプロンプト（エージェントモード時に先頭挿入）
}
```

**レスポンス**

- 通常モード（`enableTools: false`）: Content-Type `text/event-stream`。ストリーミングで逐次テキストチャンクを返す。
- エージェントモード（`enableTools: true`）: Content-Type `application/x-ndjson`。`AgentStreamEvent`（text / tool_call / tool_result / thinking / done / error）を改行区切り JSON で返す。

**エラーレスポンス**

```typescript
{ error: string }
```

| ステータス | 説明 |
|-----------|------|
| 200 | 成功（ストリーミング開始） |
| 400 | リクエスト不正（メッセージ空・10,000文字超・JSON不正等） |
| 502 | Ollama接続エラー |
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
  title?: string;  // 省略時は自動生成
}
```

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
| 500 | サーバー内部エラー |

---

### DELETE /api/conversations/[id]

会話を削除する（関連メッセージもカスケード削除）。

| ステータス | 説明 |
|-----------|------|
| 200 | 削除成功 |
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
| 404 | 会話が見つからない |
| 500 | サーバー内部エラー |

---

### POST /api/conversations/[id]/messages

メッセージを保存する。

**リクエスト**

```typescript
{
  role: 'user' | 'assistant';
  content: string;
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
| 404 | 会話が見つからない |
| 500 | サーバー内部エラー |

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
| 400 | リクエスト不正（無効なUUID、空メッセージ） |
| 500 | タイトル生成失敗 |

**備考**: Ollama APIに `stream: false` で非ストリーミングリクエストを送信する。

---

## 外部API（Ollama）

### POST /api/chat（Ollama側）

**接続先**: `${OLLAMA_BASE_URL}/api/chat`

**リクエスト**

```json
{
  "model": "qwen3-coder-next:latest",
  "messages": [
    { "role": "user", "content": "..." }
  ],
  "stream": true
}
```

**ストリーミングレスポンス（NDJSON）**

```json
{"model":"qwen3-coder-next:latest","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"qwen3-coder-next:latest","message":{"role":"assistant","content":"!"},"done":false}
{"model":"qwen3-coder-next:latest","message":{"role":"assistant","content":""},"done":true}
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
    { "name": "qwen3-coder-next:latest", "modified_at": "...", "size": 12345678 }
  ]
}
```
