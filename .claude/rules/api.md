---
description: Next.js Route Handlers（API）設計・実装ルール
globs: "front/src/app/api/**"
---

# API ルール（Next.js Route Handlers）

## 設計方針

- Next.js App Router の Route Handlers を API 層として使用する。
- フロントエンドから Ollama / Prisma への直接通信は禁止。Route Handlers を経由する。
- **Route Handler から Ollama へ直接 `fetch` しない。** 接続先・モデル解決は `lib/llm/ollama.ts` に集約し、`streamChat()`（ストリーミング）・`chatOnce()`（非ストリーミング）・`listModels()`・`getDefaultModel()` を経由する。`process.env.OLLAMA_*` を読むのも同ファイルのみとする（route ごとに既定値を持つと、チャット本体とタイトル生成で別モデルを呼ぶような不整合が起きる）。
- **添付画像の形式はサーバーが中身で決める。** 保存 API はクライアントの申告を受け取らず、`lib/server/attachment.ts` の `detectImageMimeType()`（マジックナンバー）で PNG / JPEG だけを受け付ける。`/api/chat` は画像を ID で受け、DB から読んで Ollama へ渡す（LLM へ渡す画像の選び方は `lib/server/chat-images.ts`。#6）。
- **ツールの承認待ちはモジュールの変数に置かない。** `/api/chat` が登録し、承認の API（`/api/agent/approvals/[id]`）が決着させるため、`lib/agent/approvals.ts` が `globalThis` に持つ（route ごとにモジュールが別に読み込まれても共有するため。#148 Phase A2）。
- **Route Handler から PlantUML サーバーへ直接 `fetch` しない。** 接続先（`PLANTUML_URL`）の解決とエラーの解釈は `lib/server/plantuml.ts` の `renderPlantUml()` に集約する（#171）。

## ディレクトリ構成

```
front/src/app/api/
├── chat/route.ts                          # Ollama ストリーミング通信（通常 / エージェント）
├── models/route.ts                        # 利用可能モデル一覧取得
├── tools/route.ts                         # エージェントの利用可能ツール一覧取得
├── diagrams/plantuml/route.ts             # PlantUML の図の描画（PlantUML サーバーへ中継）
├── attachments/[id]/route.ts              # 添付画像の取得（#6）
├── agent/approvals/[id]/route.ts          # ツールの実行前の承認に許可・拒否を渡す（#148 Phase A2）
└── conversations/
    ├── route.ts                           # 会話一覧取得・新規作成
    ├── search/route.ts                    # 会話のキーワード検索
    └── [id]/
        ├── route.ts                       # 会話の役割の変更（PATCH）・会話削除
        ├── messages/route.ts              # メッセージ取得・保存（assistant はブラウザのツールの画面を添付。#200）
        ├── messages/[messageId]/route.ts  # 応答の置き換え（再生成）
        └── generate-title/route.ts        # LLM でタイトル自動生成
```

## 共通方針

- RESTful 設計（リソース指向エンドポイント）
- レスポンス形式: JSON（`NextResponse.json()`）または NDJSON（ストリーミング時）
- 入力バリデーションは Route Handler 内で実施（`lib/shared/validation.ts` 参照）
- エラー時は適切な HTTP ステータスコードで返す（400/404/500）
- UUID フォーマットの検証を行う（パスパラメータの `[id]`）

## ストリーミング

- Ollama からのレスポンスは `ReadableStream` でリアルタイム中継する。
- NDJSON 形式（改行区切り JSON）でイベントをクライアントに送信する。
- `AgentStreamEvent` 型のイベント（text / tool_call / tool_result / thinking / done / error）を送信する。通常のチャット（ツールなし）も `text_delta` と `done` を送る（`done` にトークン数・所要時間。#31）。
- **停止・切断を上流へ伝える。** 返すストリームには `cancel()` を実装し、`request.signal` と合わせて Ollama への `fetch`（`streamChat` の `signal`）とツールに伝える（#8）。伝えないと、ブラウザが去った後も生成とツール実行が続き、Ollama を占有して次のリクエストを待たせる。停止はエラーとして記録・通知しない。
- **非ストリーミングの短い生成（タイトル等）には `maxTokens`（`num_predict`）で上限を付ける。** 中断する相手がいないため、小さいモデルが指示を外れると数分間 Ollama を占有する。
