---
description: Next.js Route Handlers（API）設計・実装ルール
globs: "front/src/app/api/**"
---

# API ルール（Next.js Route Handlers）

## 設計方針

- Next.js App Router の Route Handlers を API 層として使用する。
- フロントエンドから Ollama / Prisma への直接通信は禁止。Route Handlers を経由する。
- **Route Handler から Ollama へ直接 `fetch` しない。** 接続先・モデル解決は `lib/llm/ollama.ts` に集約し、`streamChat()`（ストリーミング）・`chatOnce()`（非ストリーミング）・`listModels()`・`getDefaultModel()`・`embed()`・`getEmbeddingModel()`（埋め込み。#17）を経由する。`process.env.OLLAMA_*` を読むのも同ファイルのみとする（route ごとに既定値を持つと、チャット本体とタイトル生成で別モデルを呼ぶような不整合が起きる）。
- **添付画像の形式はサーバーが中身で決める。** 保存 API はクライアントの申告を受け取らず、`lib/server/attachment.ts` の `detectImageMimeType()`（マジックナンバー）で PNG / JPEG だけを受け付ける。`/api/chat` は画像を ID で受け、DB から読んで Ollama へ渡す（LLM へ渡す画像の選び方は `lib/server/chat-images.ts`。#6）。
- **ツールの承認待ちはモジュールの変数に置かない。** `/api/chat` が登録し、承認の API（`/api/agent/approvals/[id]`）が決着させるため、`lib/agent/approvals.ts` が `globalThis` に持つ（route ごとにモジュールが別に読み込まれても共有するため。#148 Phase A2）。
- **一意制約の重複は 409 で返す。** 事前に数えて確かめず、Prisma の一意制約の違反（`P2002`）を `lib/server/prisma-error.ts` の `isUniqueConstraintError()` で判定する（メッセージのクライアント採番の `id`・プロンプトテンプレートのショートカット。#28。応答のブックマーク（1 つの応答に 1 つ）。#30）。確認と作成の間に同じ値で作られても食い違わないため。参照先を読んでから作る間に消された場合の外部キーの違反（`P2003`）は、同ファイルの `isForeignKeyConstraintError()` で 404 にする（#30）。
- **会話を返す API は同じ形にそろえる。** 一覧・作成・役割の変更・分岐は、`lib/server/conversation.ts` の `CONVERSATION_SELECT` で読み、`toConversationResponse()` で分岐元（`forkedFrom`。#29）をまとめて返す。クライアントは役割の変更の応答で一覧の会話を差し替えるため、形がずれると分岐元のリンクが消える。
- **RAG のドキュメント（#17）の DB の処理は `lib/server/knowledge.ts` にまとめる。** `vector` の列を読み書きする raw SQL を route に書かない。埋め込みは `lib/llm/ollama.ts` の `embed()` を経由し、埋め込みの失敗（502）と DB の失敗（500）を分けて返す（`lib/server/knowledge-response.ts`）。取り込みはボディを JSON ではなく `multipart/form-data` で受け、`Content-Length` が大きすぎればボディを読まずに 413 を返す。会話での参照（Phase B）も、`/api/chat` は `searchKnowledge()` を呼ぶだけにし、探すのに失敗したら応答を始めずに同じ形（502 / 500）で返す（黙ってドキュメント無しで答えない）。保管庫（#235）の列挙・読み込み・同期は `lib/server/knowledge-vault.ts`、`KNOWLEDGE_VAULTS` の解決と検索で比べる範囲は `lib/server/knowledge-vault-config.ts` にまとめ、route から git・fs に触らない。git は読むだけの決まったサブコマンドを `execFile` で起動する（シェルを介さない）。同期の API は保管庫の名前と、その中の相対パスだけを受け、サーバーが取り込まない規則を当て直してから読む。会話から覚えさせたメモ（#236）の書き込み・main へのコミット・索引への反映は `lib/server/knowledge-memory.ts` にまとめ、エージェントのツール（`save_memory`）から呼ぶ（route は足さない）。
- **Route Handler から PlantUML サーバーへ直接 `fetch` しない。** 接続先（`PLANTUML_URL`）の解決とエラーの解釈は `lib/server/plantuml.ts` の `renderPlantUml()` に集約する（#171）。

## ディレクトリ構成

```
front/src/app/api/
├── chat/route.ts                          # Ollama ストリーミング通信（通常 / エージェント。knowledgeEnabled でドキュメントを探して入れる。#17 Phase B）
├── models/route.ts                        # 利用可能モデル一覧取得
├── tools/route.ts                         # エージェントの利用可能ツール一覧取得
├── diagrams/plantuml/route.ts             # PlantUML の図の描画（PlantUML サーバーへ中継）
├── attachments/[id]/route.ts              # 添付画像の取得（#6）
├── agent/approvals/[id]/route.ts          # ツールの実行前の承認に許可・拒否を渡す（#148 Phase A2）
├── prompt-templates/
│   ├── route.ts                           # プロンプトテンプレートの一覧・作成（#28）
│   ├── [id]/route.ts                      # テンプレートの置き換え（PUT）・削除
│   └── examples/route.ts                  # 一覧が空のときに例の 4 件を作る
├── bookmarks/
│   ├── route.ts                           # 応答のブックマークの一覧（新しい順・検索・20 件ずつ）・付ける（#30）
│   └── [id]/route.ts                      # メモの書き換え（PATCH）・外す
├── knowledge/documents/
│   ├── route.ts                           # RAG のドキュメントの一覧・取り込み（multipart。#17）
│   ├── [id]/route.ts                      # 削除
│   └── [id]/rebuild/route.ts              # 今の埋め込みのモデルで作り直す
├── knowledge/vaults/
│   ├── route.ts                           # RAG の保管庫の一覧（#235）
│   ├── [name]/route.ts                    # 設定に無い保管庫の索引を消す（DELETE）
│   ├── [name]/plan/route.ts               # 同期の差分
│   └── [name]/sync/route.ts               # 1 ファイルの同期
└── conversations/
    ├── route.ts                           # 会話一覧取得・新規作成（分岐元の forkedFrom・ドキュメントの参照の knowledgeEnabled 付き。#29・#17）
    ├── search/route.ts                    # 会話のキーワード検索
    └── [id]/
        ├── route.ts                       # 会話の役割・ドキュメントの参照の変更（PATCH。送った項目だけ）・会話削除
        ├── fork/route.ts                  # 応答から会話を分岐する（その応答までを新しい会話にコピー。#29）
        ├── messages/route.ts              # メッセージ取得（付いているブックマークの ID 付き。#30）・保存（assistant はブラウザのツールの画面を添付。#200）
        ├── messages/[messageId]/route.ts  # 応答の置き換え（再生成。旧応答のブックマークは消す）
        └── generate-title/route.ts        # LLM でタイトル自動生成
```

## 共通方針

- RESTful 設計（リソース指向エンドポイント）
- レスポンス形式: JSON（`NextResponse.json()`）または NDJSON（ストリーミング時）
- 入力バリデーションは Route Handler 内で実施（`lib/shared/validation.ts` 参照）
- エラー時は適切な HTTP ステータスコードで返す（400/404/409/413/500/502）
- UUID フォーマットの検証を行う（パスパラメータの `[id]`）

## ストリーミング

- Ollama からのレスポンスは `ReadableStream` でリアルタイム中継する。
- NDJSON 形式（改行区切り JSON）でイベントをクライアントに送信する。
- `AgentStreamEvent` 型のイベント（text / tool_call / tool_result / thinking / done / error）を送信する。通常のチャット（ツールなし）も `text_delta` と `done` を送る（`done` にトークン数・所要時間。#31）。
- **停止・切断を上流へ伝える。** 返すストリームには `cancel()` を実装し、`request.signal` と合わせて Ollama への `fetch`（`streamChat` の `signal`）とツールに伝える（#8）。伝えないと、ブラウザが去った後も生成とツール実行が続き、Ollama を占有して次のリクエストを待たせる。停止はエラーとして記録・通知しない。
- **非ストリーミングの短い生成（タイトル等）には `maxTokens`（`num_predict`）で上限を付ける。** 中断する相手がいないため、小さいモデルが指示を外れると数分間 Ollama を占有する。
