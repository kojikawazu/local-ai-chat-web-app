# API設計書

## 内部API（Next.js Route Handlers）

### POST /api/chat

チャットメッセージをOllamaに送信し、ストリーミングレスポンスを返す。

**リクエスト**

```typescript
{
  message: string;
  conversationId: string;
  conversationHistory: {
    role: 'user' | 'assistant';
    content: string;
  }[];
  model?: string;  // 使用するモデル名（省略時はOLLAMA_MODEL環境変数のデフォルト値）
}
```

**レスポンス**

- Content-Type: `text/event-stream`
- ストリーミングで逐次テキストチャンクを返す

**エラーレスポンス**

```typescript
{ error: string }
```

| ステータス | 説明 |
|-----------|------|
| 200 | 成功（ストリーミング開始） |
| 400 | リクエスト不正（メッセージ空等） |
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
  "model": "qwen3-coder:latest",
  "messages": [
    { "role": "user", "content": "..." }
  ],
  "stream": true
}
```

**ストリーミングレスポンス（NDJSON）**

```json
{"model":"qwen3-coder:latest","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"qwen3-coder:latest","message":{"role":"assistant","content":"!"},"done":false}
{"model":"qwen3-coder:latest","message":{"role":"assistant","content":""},"done":true}
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
    { "name": "qwen3-coder:latest", "modified_at": "...", "size": 12345678 }
  ]
}
```
