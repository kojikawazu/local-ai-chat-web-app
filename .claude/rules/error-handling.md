---
description: エラーハンドリング方針（バリデーション・ドメイン制約・例外処理）
globs: 
---

# エラーハンドリング

- **バリデーション必須**: ユーザー入力・外部入力は必ずバリデーションする（フロントエンド + API 両方）。
- **入力制限**: 上限値の定義は `lib/shared/validation.ts` が唯一の正準（`MAX_MESSAGE_LENGTH` / `MAX_ASSISTANT_MESSAGE_LENGTH` / `MAX_TITLE_LENGTH` / `MAX_HISTORY_MESSAGES` / `MAX_SYSTEM_PROMPT_LENGTH` / `MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH`、role 別の上限は `getMaxMessageLength`）。**フロントエンドと Route Handler は同じ定数を import して検証する**（値を再定義・直書きしない）。
- **HTTP ステータスコード**: 適切なステータスコードで返す（400/401/403/404/500）。
- **ログ**: エラー時はスタックトレースを含むログを出力する。センシティブ情報はログに含めない。
- **ローカル利用のため**: エラー詳細をクライアントに返してよい（本番向けサービスでは要注意）。

## 統一エラーレスポンス

エラー時のボディは **`{ error: string }`** の 1 形状に統一する（`error` は日本語のユーザー向けメッセージ）。

```ts
return NextResponse.json({ error: '無効な会話IDです' }, { status: 400 });
```

- **現状ヘルパー関数は無く、各 Route Handler で `NextResponse.json()` を直接組む**。`lib/shared/validation.ts` は上限定数・`isValidUUID`・`getMaxMessageLength` を持つだけで、エラー応答の生成はしない。
- **JSON ボディの検証は `lib/server/request-body.ts` に集約する**（#95）。route はボディを `unknown` で受け、`readJsonBody` と route ごとの `parseXxxBody` が返す `{ ok: false, error }` をそのまま 400 で返す。`null`・配列・型違いのフィールドを型注釈だけで受けると、分割代入や `.trim()` が実行時に例外を投げて 500 になるため。新しい POST route を足すときも、ここに検証関数を足す。
- 形状は全 Route Handler で一致していること（IT で契約を検証する）。**新しい形状（`code` や `details` の追加など）を導入する場合は全 Route Handler を同時に揃える**。
- ヘルパーを導入する場合は `lib/` に置き、`lib/shared/validation.ts` には**入れない**。同ファイルはクライアントコンポーネント（`ChatBar` 等）からも import されるため、`next/server` 依存を持ち込むとクライアントバンドルが壊れる。

## バリデーションの実施順序

Route Handler では **DB アクセスの前に**入力検証を済ませる。会話の存在確認（404）より前に UUID 形式・必須項目・長さ・型を検証し、不正入力は 400 で返す。

理由: 不正入力に対して 404 を返すと「存在しない」のか「入力が不正」なのか区別できず、エンドポイント間で契約が食い違う（`id` 列が TEXT のため Prisma は不正な UUID でも例外を投げず `null` を返す）。
