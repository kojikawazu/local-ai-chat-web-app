# API設計書

> 最終更新: 2026-10-31

## 目次

- [内部API（Next.js Route Handlers）](#内部apinextjs-route-handlers)
  - [POST /api/chat](#post-apichat)
  - [GET /api/conversations](#get-apiconversations)
  - [POST /api/conversations](#post-apiconversations)
  - [GET /api/conversations/search](#get-apiconversationssearch)
  - [PATCH /api/conversations/[id]](#patch-apiconversationsid)
  - [DELETE /api/conversations/[id]](#delete-apiconversationsid)
  - [POST /api/conversations/[id]/fork](#post-apiconversationsidfork)
  - [GET /api/conversations/[id]/messages](#get-apiconversationsidmessages)
  - [POST /api/conversations/[id]/messages](#post-apiconversationsidmessages)
  - [PUT /api/conversations/[id]/messages/[messageId]](#put-apiconversationsidmessagesmessageid)
  - [GET /api/models](#get-apimodels)
  - [GET /api/tools](#get-apitools)
  - [POST /api/conversations/[id]/generate-title](#post-apiconversationsidgenerate-title)
  - [POST /api/diagrams/plantuml](#post-apidiagramsplantuml)
  - [GET /api/attachments/[id]](#get-apiattachmentsid)
  - [POST /api/agent/approvals/[id]](#post-apiagentapprovalsid)
  - [GET /api/prompt-templates](#get-apiprompt-templates)
  - [POST /api/prompt-templates](#post-apiprompt-templates)
  - [PUT /api/prompt-templates/[id]](#put-apiprompt-templatesid)
  - [DELETE /api/prompt-templates/[id]](#delete-apiprompt-templatesid)
  - [POST /api/prompt-templates/examples](#post-apiprompt-templatesexamples)
  - [GET /api/bookmarks](#get-apibookmarks)
  - [POST /api/bookmarks](#post-apibookmarks)
  - [PATCH /api/bookmarks/[id]](#patch-apibookmarksid)
  - [DELETE /api/bookmarks/[id]](#delete-apibookmarksid)
- [外部API（Ollama）](#外部apiollama)
  - [POST /api/chat（Ollama側）](#post-apichatollama側)
  - [GET /api/tags（Ollama側）](#get-apitagsollama側)
  - [POST /api/show（Ollama側）](#post-apishowollama側)
- [外部API（PlantUML サーバー）](#外部apiplantuml-サーバー)
  - [POST /svg（PlantUML サーバー側）](#post-svgplantuml-サーバー側)

## 内部API（Next.js Route Handlers）

### リクエストボディの検証（全 POST・PUT・PATCH 共通）

ボディは `unknown` として読み取り、`front/src/lib/server/request-body.ts` の検証関数（`parseChatBody` 等）を通してから DB・Ollama へ渡す（#95）。JSON として構文が正しくても API の形に合わない入力は、すべて `{ error: string }` + 400 で返す。

- ボディは JSON オブジェクトであること（`null`・配列・数値・文字列は 400）
- 各フィールドは型を検証する（文字列に数値、真偽値に文字列などは 400）
- 任意フィールドは `undefined` と `null` のどちらも「指定なし」として扱う
- 上限値は `front/src/lib/shared/validation.ts` が正準（`MAX_MESSAGE_LENGTH` / `MAX_ASSISTANT_MESSAGE_LENGTH` / `MAX_TITLE_LENGTH` / `MAX_HISTORY_MESSAGES` / `MAX_SYSTEM_PROMPT_LENGTH` / `MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH`、添付画像の `MAX_IMAGES_PER_MESSAGE` / `MAX_IMAGES_PER_REQUEST` / `MAX_IMAGE_LONG_EDGE` / `MAX_IMAGE_BYTES`、プロンプトテンプレートの `MAX_PROMPT_TEMPLATE_NAME_LENGTH` / `MAX_PROMPT_TEMPLATE_SHORTCUT_LENGTH` / `MAX_PROMPT_TEMPLATES`）

### POST /api/chat

チャットメッセージをOllamaに送信し、ストリーミングレスポンスを返す。
`enableTools: true` の場合はエージェントモードとなり、ツール呼び出しを含む NDJSON イベントストリームを返す。画像を読めないモデル（`/api/show` の `capabilities` に `vision` が無い）には、結果を画像で渡すツール（`browser_screenshot`。#149）を渡さない。ブラウザのツールは、このリクエストのオリジン（アプリ自身）を開かない。

**リクエスト**

```typescript
{
  message: string;
  imageIds?: string[];     // 送信する質問の添付画像の ID（保存済み。UUID・重複なし・最大 4 枚。#6）
  conversationHistory?: {   // 最大 1,000 件
    role: 'user' | 'assistant';  // system は systemPrompt、tool はサーバー内のエージェントループだけが作る
    content: string;             // user は最大 10,000 文字、assistant は最大 100,000 文字（保存上限と同じ）
    imageIds?: string[];         // そのメッセージの添付画像の ID（user だけ。最大 4 枚）
  }[];
  model?: string;          // 使用するモデル名（省略時はOLLAMA_MODEL環境変数のデフォルト値）
  enableTools?: boolean;   // true でエージェントモード（ツール呼び出し有効）。デフォルト false
  systemPrompt?: string;   // システムプロンプト。通常・エージェントとも先頭の system メッセージにする（後ろに現在の日時を足す）。最大 10,000 文字
}
```

履歴の要素は `role`・`content`・`imageIds` だけに詰め直して Ollama へ渡す（`tool_calls` などの余分な項目は送らない）。

**添付画像（#6）**: 画像の中身ではなく ID を受け取り、サーバーが DB（`Attachment`）から読んで Base64 にし、Ollama のメッセージの `images` に入れる（通常・エージェントとも）。設計は `docs/13-image-attachment.md`。

- 画像が 1 枚も無ければ、Ollama の `/api/show` も DB も呼ばない（従来どおり）。
- 画像がある場合はモデルの `capabilities`（Ollama の `/api/show`）を確かめる。送信する質問に画像があり、モデルが `vision` に対応していなければ 400。履歴にだけ画像がある場合は画像を渡さず、本文の末尾に `（画像 n 枚を添付。このモデルは画像に対応していないため省略）` を足して続ける。
- 渡す画像は新しいメッセージから合計 `MAX_IMAGES_PER_REQUEST`（8）枚まで。メッセージ単位で選び、収まらないメッセージとそれより古い画像は渡さず、本文の末尾に `（画像 n 枚を添付。古いため省略）` を足す（`lib/server/chat-images.ts`）。

`systemPrompt` は、クライアントが会話の役割（`Conversation.systemPrompt`）を先に、エージェントモードならそのプリセットを後に置き、空行で区切って連結したもの（`lib/chat/system-prompt.ts` の `buildSystemPrompt`。#10）。サーバーは前後の空白を除き、その後ろに「現在の日時」の節（日付・曜日・時刻・サーバーのタイムゾーンと、モードごとの「最新」の扱いの指示）を空行で区切って足し、会話履歴の先頭に `role: 'system'` として付ける（`lib/llm/current-date.ts` の `withCurrentDate` と `lib/llm/ollama.ts` の `withSystemPrompt`。#154）。`systemPrompt` が空でも、日時の節だけの system メッセージを付ける。日時はリクエストごとに作る。会話の役割の上限（5,000 文字）に最長のエージェントのプリセットを足しても 10,000 文字に収まる（UT で検証）。クライアント（`lib/chat/conversation-history.ts`）は送信前に履歴を上限内に収める（新しい方から 1,000 件、本文は role 別の上限で切り詰め）。

**レスポンス**

- 通常モード（`enableTools: false`）: Content-Type `application/x-ndjson`。本文を `text_delta` で逐次返し、終わりに `done` を送る。`done` の `metadata.metrics` は Ollama の終わりのチャンクのトークン数・所要時間（#31。`docs/19-token-metrics.md`。Ollama が返さなければ `metadata` を持たない）。Ollama には `think: false` を送り、思考に対応したモデルにも思考させない（最初の文字までの時間を優先するため。思考過程は返さない）。#31 より前は本文の文字列を `text/event-stream` で返していた。
- エージェントモード（`enableTools: true`）: Content-Type `application/x-ndjson`。`AgentStreamEvent`（text / tool_call / tool_result / thinking / done / error）を改行区切り JSON で返す。`done` の `metadata.metrics` はラウンドのトークン数・所要時間の合計（#31）。

**停止・切断**: ブラウザが停止・切断すると（応答ストリームの cancel・`request.signal` の abort）、Ollama への接続を切って生成を止める（#8）。エージェントモードでは実行中のツールも中断し、次のラウンドへ進まず、イベントを送らずにストリームを閉じる（`error` は送らない）。停止はエラーとして記録しない。

**エラーレスポンス**

```typescript
{ error: string }
```

| ステータス | 説明 |
|-----------|------|
| 200 | 成功（ストリーミング開始） |
| 400 | リクエスト不正（JSON不正・ボディが非オブジェクト・メッセージ空・10,000文字超・各フィールドの型不正・履歴の件数／role／content 長さ不正・systemPrompt 上限超過・`imageIds` の形式／枚数／重複の不正・assistant の `imageIds`・画像に対応していないモデルへの画像の送信・見つからない添付） |
| 502 | Ollama接続エラー（画像があるときのモデルの対応機能の問い合わせを含む） |
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
    systemPrompt: string | null;  // 会話の役割。役割なしは null（#10）
    createdAt: string;
    updatedAt: string;
    // 分岐元（#29）。分岐していない会話・分岐元が消えた会話は null
    forkedFrom: { conversationId: string; messageId: string; title: string } | null;
  }[];
}
```

会話を返す API（一覧・作成・役割の変更・分岐）は、同じ形の会話を返す（`lib/server/conversation.ts` の `CONVERSATION_SELECT`・`toConversationResponse`）。分岐元のタイトルは、分岐した応答から元の会話をたどって 1 回のクエリで引く。

| ステータス | 説明 |
|-----------|------|
| 200 | 成功 |
| 500 | サーバー内部エラー |

---

### GET /api/conversations/search

会話をキーワードで検索する（#11）。空白（全角を含む）で区切った語の**すべて**を、会話のタイトルかメッセージの本文（質問・応答）のどこかに含む会話を、更新日時の新しい順に返す（AND）。思考過程・ツールの結果（`metadata`）は対象外。

- 一致は大文字・小文字を区別しない部分一致（PostgreSQL の `ILIKE`）。`%`・`_` は文字そのものとして扱う（Prisma の `contains` はエスケープしないため、`lib/conversation/search.ts` の `escapeLikePattern` でエスケープする）
- 大文字・小文字だけが違う語の重複は 1 つにまとめる

**クエリパラメータ**

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `q` | ✅ | キーワード。前後の空白を除いて 1〜`MAX_SEARCH_QUERY_LENGTH`（100）文字、`MAX_SEARCH_TERMS`（5）語まで |
| `offset` | — | 何件目から返すか（0 以上の整数。省略時 0）。「さらに表示」で使う |

**レスポンス**

```typescript
{
  results: {
    id: string;
    title: string;
    updatedAt: string;
    // 最初にキーワードが現れたメッセージ（作成順）の、一致箇所の前後 40 文字の抜粋。
    // 途中で切った側に「…」を付け、改行・連続する空白は 1 つの空白にまとめる。
    // タイトルにしか一致しなかった会話は null
    snippet: string | null;
  }[];
  hasMore: boolean;  // 続き（offset + 20 件目以降）があるか
}
```

1 回に返すのは 20 件まで。

| ステータス | 説明 |
|-----------|------|
| 200 | 成功（一致が無ければ `results: []`） |
| 400 | `q` が無い・空白だけ・長すぎる・語が多すぎる、`offset` が 0 以上の整数でない |
| 500 | サーバー内部エラー |

---

### POST /api/conversations

新規会話を作成する。

**リクエスト**

```typescript
{
  title?: string;         // 省略・空文字時は既定タイトル「新しい会話」。最大100文字
  systemPrompt?: string | null;  // 会話の役割。省略・null・空白のみなら役割なし（null）。前後の空白は除く。最大 5,000 文字（#10）
}
```

最初の送信の前に選んだ役割を、会話の作成と同時に保存するために `systemPrompt` を受け付ける。

ボディ自体を省略（空の本文）した場合も既定タイトルで作成する。本文があるのに JSON として不正・オブジェクトでない場合は 400（#95 以前は構文エラーを握りつぶして既定タイトルで作成していた）。

**レスポンス**

[会話一覧](#get-apiconversations)の 1 件と同じ形（`forkedFrom` を含む。作成した会話では `null`）。

| ステータス | 説明 |
|-----------|------|
| 201 | 作成成功 |
| 400 | リクエスト不正（JSON不正・ボディが非オブジェクト・title / systemPrompt が文字列でない・title が100文字超・systemPrompt が 5,000 文字超） |
| 500 | サーバー内部エラー |

上限値は `front/src/lib/shared/validation.ts` の `MAX_TITLE_LENGTH`・`MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH` が正準。

---

### PATCH /api/conversations/[id]

会話の役割（システムプロンプト）を変更する（#10）。変更は以降の送信から効き、これまでの応答はそのまま残る。

**リクエスト**

```typescript
{
  systemPrompt: string | null;  // 必須。null・空白のみなら役割を外す。前後の空白は除く。最大 5,000 文字
}
```

- 変更できるのは `systemPrompt` だけ（`title` 等の他のフィールドは無視する）。
- `systemPrompt` キーの省略は 400。「変えない」と「外す」を区別できないため、外すときは `null` か空文字を明示する。
- `updatedAt` も更新されるため、会話一覧の先頭に来る（タイトルの自動生成と同じ扱い）。
- 存在しない会話は、UPDATE の更新件数（`updateMany` の `count`）で 404 と判定する（DELETE と同じ）。

**レスポンス**

[会話一覧](#get-apiconversations)の 1 件と同じ形（`forkedFrom` を含む。作成した会話では `null`）。

| ステータス | 説明 |
|-----------|------|
| 200 | 変更成功 |
| 400 | リクエスト不正（無効なUUID・JSON不正・ボディが非オブジェクト・systemPrompt キーが無い・文字列 / null でない・5,000 文字超） |
| 404 | 会話が見つからない |
| 500 | サーバー内部エラー |

---

### DELETE /api/conversations/[id]

会話を削除する（関連メッセージもカスケード削除）。この会話の応答から分岐した会話（#29）は残り、その `forkedFrom` は `null` になる。

| ステータス | 説明 |
|-----------|------|
| 200 | 削除成功 |
| 400 | リクエスト不正（無効なUUID） |
| 404 | 会話が見つからない |
| 500 | サーバー内部エラー |

---

### POST /api/conversations/[id]/fork

会話の途中の応答から分岐する（#29。`docs/22-conversation-fork.md`）。その応答までのメッセージを新しい会話にコピーし、新しい会話を返す。

**リクエスト**

```typescript
{
  messageId: string;  // 必須。分岐する応答（assistant のメッセージ）の UUID
}
```

- コピーするのは、表示と同じ順（`createdAt` の昇順）でその応答までのメッセージ（その応答を含む）。本文・role・`createdAt`（元のまま）・metadata・添付画像（中身ごと新しい ID で。metadata の中のツールの画面の ID も書き換える）。ブックマークはコピーしない。
- 新しい会話のタイトルは `元のタイトル（分岐）`（もう `（分岐）` で終わっていれば足さない。100 文字に収める）。役割（`systemPrompt`）は元のまま。`forkedFromMessageId` に分岐した応答を入れる。
- 会話・メッセージ・添付画像は 1 回の入れ子の作成（1 トランザクション）で作り、途中で失敗したら何も残さない。
- user のメッセージは 400。メッセージがその会話に無ければ 404。読んでから作る間に分岐元の応答が消された場合（外部キーの違反 `P2003`）も 404。

**レスポンス**

[会話一覧](#get-apiconversations)の 1 件と同じ形（`forkedFrom` に分岐元の会話の ID・応答の ID・タイトル）。

| ステータス | 説明 |
|-----------|------|
| 201 | 作成成功 |
| 400 | リクエスト不正（無効な会話 UUID・JSON 不正・ボディが非オブジェクト・`messageId` が UUID の文字列でない・user のメッセージ） |
| 404 | 会話が見つからない・メッセージがその会話に無い |
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
    attachments: {            // 添付画像（#6）。assistant はブラウザのツールが撮った画面（#200。metadata.toolCalls[].screenshots の ID で参照する）。並び順。中身は含めない（GET /api/attachments/[id] で取得）
      id: string;
      mimeType: 'image/png' | 'image/jpeg';
      width: number;
      height: number;
    }[];
    bookmark: { id: string } | null; // 付いているブックマーク（#30）。付いていなければ null
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
  id?: string | null;                       // クライアントが採番したメッセージ ID（UUID。任意。省略時は DB が採番）
  role: 'user' | 'assistant';
  content: string;                          // user は最大10,000文字、assistant は最大100,000文字
  metadata?: Record<string, unknown> | null; // ツール呼び出し情報・思考過程等（任意。JSONオブジェクトのみ）
  attachments?: {                           // 画像（任意）。user は添付画像（最大 4 枚。#6）、assistant はブラウザのツールが撮った画面（最大 20 枚。#200）
    id: string;                             // 添付 ID（UUID）。user はクライアントが採番し /api/chat の imageIds で参照する。assistant はサーバーが撮ったときに採番した ID
    data: string;                           // data: の接頭辞なしの Base64。復号後 5MB まで。中身が PNG / JPEG であること
    width: number;                          // 1〜1,280 の整数（表示の枠の確保にだけ使う）
    height: number;
  }[] | null;
}
```

添付の形式はクライアントの申告を受け取らず、復号したバイト列の先頭（マジックナンバー）で PNG / JPEG を判定して保存する（`lib/server/attachment.ts`）。メッセージ・添付・会話の `updatedAt` の更新は同一トランザクションで行う。

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
| 400 | リクエスト不正（無効なUUID・JSON不正・ボディが非オブジェクト・role/content 欠落・role 不正・content が文字列でない・content が上限超過（user 10,000 / assistant 100,000 文字）・metadata が非オブジェクト・id が UUID 形式でない・attachments の不正（role ごとの枚数（user 4 / assistant 20）・ID・寸法・Base64・5MB 超・PNG / JPEG でない）） |
| 404 | 会話が見つからない |
| 409 | 同じ `id` のメッセージ（または添付）が既に存在する |
| 500 | サーバー内部エラー |

上限値は `front/src/lib/shared/validation.ts` が正準。user は `MAX_MESSAGE_LENGTH`（`POST /api/chat` と同一の上限をフロント・API 双方で検証する）、assistant は `MAX_ASSISTANT_MESSAGE_LENGTH`（LLM 出力は長さを制御できないため入力上限と分ける）。

メッセージの作成と会話の `updatedAt` 更新は同一トランザクションで行い、片方だけが成功する部分成功を起こさない。

クライアント（`useChat`）は 2xx 以外を保存失敗として扱い、該当メッセージに失敗表示と再試行ボタンを出す。user メッセージの保存に失敗した場合は `POST /api/chat` を呼ばない（再送で保存できてから応答を生成する）。

クライアントは画面上のメッセージ ID を `id` に指定して保存し、画面と DB の ID を揃える（再生成で置き換える応答を特定するため。#9）。保存の再試行で 409 を受けた場合は、前回の保存がサーバーに届いていた（応答だけが失われた）ものとして成功扱いにする。

---

### PUT /api/conversations/[id]/messages/[messageId]

再生成した応答で、既存の assistant の応答を置き換える（#9）。

**リクエスト**

```typescript
{
  content: string;                          // 空でない文字列。最大100,000文字（assistant の上限）
  metadata?: Record<string, unknown> | null; // 置き換え後の metadata（任意。省略時は旧応答の metadata を消す）
  attachments?: {                           // 置き換え後の応答の画面（任意。ブラウザのツールが撮った画面。最大 20 枚。形は POST と同じ。#200）
    id: string;
    data: string;
    width: number;
    height: number;
  }[] | null;
}
```

**レスポンス**: 置き換え後のメッセージ（`POST` のレスポンスと同じ形）

| ステータス | 説明 |
|-----------|------|
| 200 | 置き換え成功 |
| 400 | リクエスト不正（会話 ID・メッセージ ID が UUID 形式でない・JSON不正・ボディが非オブジェクト・content が空または文字列でない・content が上限超過・metadata が非オブジェクト・attachments の不正） |
| 404 | その会話に属する assistant の応答が見つからない（user のメッセージ・別の会話のメッセージも 404） |
| 500 | サーバー内部エラー |

本文・metadata とあわせて `createdAt` を現在時刻にする（表示する時刻を再生成した時刻にするため。再生成できるのは最後の応答だけなので、並び順は変わらない）。会話の `updatedAt` の更新と同一トランザクションで行う。旧応答の画面（添付）は同じトランザクションで消し、`attachments` に入れ替える（#200）。旧応答に付けたブックマーク（#30）も同じトランザクションで消す（付けたのは前の本文のため）。

クライアントは生成し終えてから置き換える。生成に失敗した場合・本文が出る前に停止した場合は呼ばず、旧応答の表示に戻す。

---

### GET /api/models

Ollamaで利用可能なモデル一覧を取得する。

**レスポンス**

```typescript
{
  models: string[];       // モデル名の配列
  visionModels: string[]; // 画像入力（vision）に対応したモデル名の配列（#6）
  defaultModel: string;   // デフォルトモデル名（環境変数OLLAMA_MODEL）
}
```

`visionModels` は、モデルごとに Ollama の `/api/show` を並列に呼び、`capabilities` に `vision` があるものを並べる。問い合わせに失敗したモデルは `visionModels` から外すだけにし、一覧の取得自体は失敗させない。

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
    name: string;         // ツール名（get_current_datetime, calculate, web_search, url_fetch。LOCAL_FILE_ROOTS があれば list_directory, search_files, read_file、LOCAL_FILE_WRITE_ROOTS があれば write_file, edit_file、LOCAL_COMMANDS もあれば run_command、GITHUB_REPOS があれば github_* の 5 つ（#148）、BROWSER_ENABLED=true なら browser_navigate, browser_snapshot, browser_screenshot（#149）と browser_click, browser_type, browser_select（#149 Phase C）も）
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

### POST /api/diagrams/plantuml

応答の PlantUML のコードブロックを、ローカルの PlantUML サーバーで SVG にして返す（#171）。ブラウザから PlantUML サーバーへ直接つながず、ここを経由する。SVG はクライアントが data: URI の `<img>` で表示する。

**リクエスト**

```typescript
{
  source: string;   // PlantUML のソース（書かれたまま送る。@startuml が無ければ PlantUML サーバーが補う。上限 50,000 文字）
}
```

**レスポンス**

```typescript
{
  svg: string;      // PlantUML サーバーが返した SVG
}
```

| ステータス | 説明 |
|-----------|------|
| 200 | 描画成功 |
| 400 | リクエスト不正（JSON不正・ボディが非オブジェクト・`source` が文字列でない・空白だけ・上限 `MAX_DIAGRAM_SOURCE_LENGTH` 超過）、または PlantUML が描けなかった（構文の誤り・SANDBOX で止めた include 等）。後者の `error` は PlantUML の理由に 1 始まりの行番号を添える（例: `Syntax Error? (Assumed diagram type: sequence)（2 行目）`） |
| 502 | PlantUML サーバーに繋がらない・10 秒で応答しない・想定外の応答（`error` に `docker compose up -d` での起動の案内を入れる） |
| 499 | 応答前にクライアントが切断した（本文なし。`request.signal` で PlantUML への fetch も止める） |

**備考**: 接続先は環境変数 `PLANTUML_URL`（既定 `http://localhost:8889`）。`lib/server/plantuml.ts` だけが読む。

---

### GET /api/attachments/[id]

添付画像の中身を返す（#6）。

**レスポンス**: 画像のバイト列

| ヘッダー | 値 |
|---|---|
| `Content-Type` | 保存時に中身から判定した形式（`image/png` / `image/jpeg`） |
| `Cache-Control` | `private, max-age=31536000, immutable`（添付は作った後に変わらない） |
| `X-Content-Type-Options` | `nosniff`（ブラウザに形式を推測させない） |

| ステータス | 説明 |
|-----------|------|
| 200 | 成功 |
| 400 | 無効なUUID |
| 404 | 添付が見つからない（会話の削除でカスケード削除された場合を含む） |
| 500 | サーバー内部エラー |

---

### POST /api/agent/approvals/[id]

エージェントのツールの実行前の承認に、許可か拒否かを渡す（#148 Phase A2。`docs/15-tool-approval.md`）。ファイルの書き込み・コマンドの実行（#148 Phase B。`docs/16-command-execution.md`）・GitHub へのコメントと PR の作成（#148 Phase C。`docs/17-github-tools.md`）・ブラウザの操作（#149 Phase C。`docs/18-browser-tools.md`。`preview` の `action` は `browser-action`）で同じ API を使う。`[id]` は `/api/chat` のストリームの `tool_approval_request` の `approvalId`。同じイベントの `timeoutMs`（待ち時間の上限。5 分）を過ぎると時間切れになり、画面は承認カードに残り時間を出す（#202）。

**リクエスト**

```json
{ "approved": true }
```

| ステータス | 説明 |
|-----------|------|
| 204 | 待っている承認に結果を渡した（実行の結果は `/api/chat` のストリームの `tool_call_result` で届く） |
| 400 | 無効な UUID・`approved` が真偽値でない |
| 404 | 待っている承認が無い（知らない ID・決着済み・5 分の時間切れ・停止済み） |

**備考**: 承認待ちはサーバーのメモリ（`lib/agent/approvals.ts`。`globalThis`）に持つ。ストリームを開いたまま待つため、サーバーのプロセスが 1 つであることが前提（localhost の個人利用）。

---

### GET /api/prompt-templates

プロンプトテンプレート（#28。`docs/20-prompt-templates.md`）の一覧を、ショートカットの昇順で返す。最大 100 件のため、ページに分けない。

**レスポンス**

```typescript
{
  templates: {
    id: string;
    name: string;
    shortcut: string;   // `/` の後ろに打つ名前（先頭の `/` は含めない。小文字）
    content: string;    // 入力欄に入れる本文（前後の空白・改行も書いたまま）
    createdAt: string;
    updatedAt: string;
  }[];
}
```

| ステータス | 説明 |
|-----------|------|
| 200 | 取得成功（0 件なら空配列） |
| 500 | サーバー内部エラー |

---

### POST /api/prompt-templates

プロンプトテンプレートを作成する（#28）。

**リクエスト**

```typescript
{
  name: string;      // 必須。前後の空白は除く。最大 50 文字
  shortcut: string;  // 必須。前後の空白を除いて小文字にする。英小文字・数字・`-`・`_` で、英小文字か数字で始める。最大 32 文字
  content: string;   // 必須。空白だけは不可。前後の空白・改行は残す。最大 10,000 文字
}
```

- 件数の上限（100 件）は作成の前に数える。
- ショートカットの重複は、一意制約の違反（Prisma の `P2002`）で判定して 409 を返す（事前の確認では判定しない）。

**レスポンス**: 作成したテンプレート（`GET` の 1 件と同じ形）

| ステータス | 説明 |
|-----------|------|
| 201 | 作成成功 |
| 400 | リクエスト不正（JSON 不正・ボディが非オブジェクト・文字列でない・名前が空 / 50 文字超・ショートカットの形・本文が空白だけ / 10,000 文字超・100 件に達している） |
| 409 | ショートカットが既に使われている |
| 500 | サーバー内部エラー |

---

### PUT /api/prompt-templates/[id]

プロンプトテンプレートを置き換える（#28）。ボディは `POST /api/prompt-templates` と同じ（名前・ショートカット・本文をすべて送る）。

- 存在しないテンプレートは、UPDATE の更新件数で 404 と判定する（会話の役割の変更と同じ）。
- 自分自身と同じショートカットのままの置き換えは重複にならない。

**レスポンス**: 置き換えたテンプレート

| ステータス | 説明 |
|-----------|------|
| 200 | 置き換え成功 |
| 400 | リクエスト不正（無効なUUID・ボディは POST と同じ） |
| 404 | テンプレートが見つからない |
| 409 | ショートカットが別のテンプレートで使われている |
| 500 | サーバー内部エラー |

---

### DELETE /api/prompt-templates/[id]

プロンプトテンプレートを削除する（#28）。存在しないテンプレートは削除件数で 404 と判定する。

| ステータス | 説明 |
|-----------|------|
| 200 | 削除成功（`{ success: true }`） |
| 400 | リクエスト不正（無効なUUID） |
| 404 | テンプレートが見つからない |
| 500 | サーバー内部エラー |

---

### POST /api/prompt-templates/examples

一覧が空のときだけ、例のテンプレート 3 件（`translate`・`review`・`summarize`）を作る（#28。既定のテンプレートは持たない）。ボディは無い。

- 空かの確認と作成を 1 つのトランザクションで行う。二度押しで同時に届いた 2 回目は、確認をすり抜けてもショートカットの一意制約で失敗するため、どちらも 409 にして何も作らない。

**レスポンス**

```typescript
{ templates: PromptTemplate[] }  // 作った 3 件（ショートカットの昇順）
```

| ステータス | 説明 |
|-----------|------|
| 201 | 作成成功 |
| 409 | 一覧が空でない |
| 500 | サーバー内部エラー |

---

### GET /api/bookmarks

応答のブックマーク（#30。`docs/21-bookmarks.md`）の一覧を、付けた日時の新しい順に 20 件ずつ返す。

**クエリパラメータ**

| 名前 | 説明 |
|------|------|
| `q` | 任意。空白（全角を含む）で区切ったキーワード。最大 100 文字・5 語。すべての語を、メモ・応答の本文・会話のタイトルのどこかに含むものに絞る（語ごとに OR、語どうしは AND）。大文字・小文字を区別しない部分一致で、`%`・`_` は文字そのもの。空なら絞り込まない |
| `offset` | 任意。何件目から返すか（0 以上の整数。省略時 0） |

解釈は会話の検索（`GET /api/conversations/search`）と同じ（`parseSearchQuery` の `allowEmpty`）。思考過程・ツールの結果（`metadata`）は対象外。

**レスポンス**

```typescript
{
  bookmarks: {
    id: string;
    note: string | null;        // メモ（無ければ null）
    createdAt: string;          // 付けた日時
    messageId: string;          // 応答の ID（移る先）
    conversationId: string;     // 会話の ID（開く会話）
    conversationTitle: string;
    snippet: string;            // 応答の抜粋。語が本文に現れればその前後、無ければ先頭から 120 文字（改行・連続する空白は 1 つに）
  }[];
  hasMore: boolean;             // 続きがあるか
}
```

| ステータス | 説明 |
|-----------|------|
| 200 | 取得成功（0 件なら空配列） |
| 400 | リクエスト不正（`q` が長すぎる・語が多すぎる、`offset` が 0 以上の整数でない） |
| 500 | サーバー内部エラー |

---

### POST /api/bookmarks

応答（assistant のメッセージ）にブックマークを付ける（#30）。メモは付けない（`PATCH` で後から書く）。

**リクエスト**

```typescript
{
  messageId: string;  // 必須。応答の UUID
}
```

- user のメッセージは 400。メッセージが無ければ 404。メッセージを読んでから作る間に消された場合（外部キーの違反 `P2003`）も 404。
- もう付いている応答は、一意制約の違反（`P2002`）で判定して 409 を返す（事前の確認では判定しない）。

**レスポンス**

```typescript
{
  id: string;
  messageId: string;
  note: null;
  createdAt: string;
  updatedAt: string;
}
```

| ステータス | 説明 |
|-----------|------|
| 201 | 作成成功 |
| 400 | リクエスト不正（JSON 不正・ボディが非オブジェクト・`messageId` が UUID の文字列でない・user のメッセージ） |
| 404 | メッセージが見つからない |
| 409 | もうブックマークしている |
| 500 | サーバー内部エラー |

---

### PATCH /api/bookmarks/[id]

ブックマークのメモを書き換える（#30）。存在しないブックマークは UPDATE の更新件数で 404 と判定する。

**リクエスト**

```typescript
{
  note: string | null;  // 必須。前後の空白を除いて保存する。最大 500 文字。null・空白だけはメモを消す（null にする）
}
```

**レスポンス**: 書き換えたブックマーク（`POST` のレスポンスと同じ形）

| ステータス | 説明 |
|-----------|------|
| 200 | 書き換え成功 |
| 400 | リクエスト不正（無効なUUID・JSON 不正・ボディが非オブジェクト・`note` が無い / 文字列と null 以外・500 文字超） |
| 404 | ブックマークが見つからない |
| 500 | サーバー内部エラー |

---

### DELETE /api/bookmarks/[id]

ブックマークを外す（#30）。応答は残る。存在しないブックマークは削除件数で 404 と判定する。

| ステータス | 説明 |
|-----------|------|
| 200 | 削除成功（`{ success: true }`） |
| 400 | リクエスト不正（無効なUUID） |
| 404 | ブックマークが見つからない |
| 500 | サーバー内部エラー |

---

## 外部API（Ollama）

### POST /api/chat（Ollama側）

**接続先**: `${OLLAMA_BASE_URL}/api/chat`

**リクエスト**

```json
{
  "model": "qwen3.8:27b",
  "messages": [
    { "role": "user", "content": "...", "images": ["iVBORw0KGgo..."] }
  ],
  "stream": true
}
```

`images`（`data:` の接頭辞なしの Base64）は添付画像があるメッセージにだけ付ける（#6）。画像に対応していないモデルに送ると、Ollama は 400（`Multimodal data provided, but model does not support multimodal requests.`）を返す。

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

---

### POST /api/show（Ollama側）

**接続先**: `${OLLAMA_BASE_URL}/api/show`

モデルの詳細を取得する。`capabilities`（`completion` / `vision` / `tools` / `thinking` 等）で、画像入力に対応しているかを判定する（`lib/llm/ollama.ts` の `getModelCapabilities` / `supportsVision`。#6）。`/api/models` と、画像を含む `/api/chat` から呼び出される。

**リクエスト**: `{ "model": "qwen3.8:27b" }`

**レスポンス（抜粋）**: `{ "capabilities": ["completion", "vision", "tools", "thinking"] }`

---

## 外部API（PlantUML サーバー）

### POST /svg（PlantUML サーバー側）

**接続先**: `${PLANTUML_URL}/svg`（公式イメージ `plantuml/plantuml-server`。`docker-compose.yml` の `plantuml` サービス）

本文に PlantUML のソースをそのまま（`text/plain`）送ると、SVG（`image/svg+xml`）を返す。`/api/diagrams/plantuml` Route Handler から呼び出される。

| ステータス | 説明 |
|-----------|------|
| 200 | 描画成功。本文が SVG |
| 400 | 描けなかった。理由を `X-PlantUML-Diagram-Error`、行番号（0 始まり）を `X-PlantUML-Diagram-Error-Line` に入れる（本文はエラーを描いた SVG） |

**備考**: コンテナは `PLANTUML_SECURITY_PROFILE=SANDBOX` で動かす。外部の URL・ファイルの `!include` は「Cannot open URL」「cannot include」の 400 になる（同梱の標準ライブラリは使える）。理由は `docs/11-syntax-highlight-diagrams.md` の「セキュリティ（SANDBOX）」。
