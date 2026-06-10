---
description: Next.js Route Handlers（API）設計・実装ルール
globs: "front/src/app/api/**"
---

# API ルール（Next.js Route Handlers）

## 設計方針

- Next.js App Router の Route Handlers を API 層として使用する。
- フロントエンドから Ollama / Prisma への直接通信は禁止。Route Handlers を経由する。

## ディレクトリ構成

```
front/src/app/api/
├── chat/route.ts                          # Ollama ストリーミング通信（通常 / エージェント）
├── models/route.ts                        # 利用可能モデル一覧取得
├── tools/route.ts                         # エージェントの利用可能ツール一覧取得
└── conversations/
    ├── route.ts                           # 会話一覧取得・新規作成
    └── [id]/
        ├── route.ts                       # 会話削除
        ├── messages/route.ts              # メッセージ取得・保存
        └── generate-title/route.ts        # LLM でタイトル自動生成
```

## 共通方針

- RESTful 設計（リソース指向エンドポイント）
- レスポンス形式: JSON（`NextResponse.json()`）または NDJSON（ストリーミング時）
- 入力バリデーションは Route Handler 内で実施（`lib/validation.ts` 参照）
- エラー時は適切な HTTP ステータスコードで返す（400/404/500）
- UUID フォーマットの検証を行う（パスパラメータの `[id]`）

## ストリーミング

- Ollama からのレスポンスは `ReadableStream` でリアルタイム中継する。
- NDJSON 形式（改行区切り JSON）でイベントをクライアントに送信する。
- エージェントモード時は `AgentStreamEvent` 型のイベント（text / tool_call / tool_result / thinking / done / error）を送信する。
