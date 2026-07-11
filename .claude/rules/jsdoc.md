---
description: JSDoc（TSDoc）ドキュメンテーションコメント規約 — TypeScript の公開シンボルに必須
globs: front/src/**
---

# JSDoc 規約（TypeScript）

TypeScript コードの**公開シンボル**には JSDoc（TSDoc 記法）を**必須**とする。TypeDoc によるドキュメント生成を前提とする。

## 必須対象（公開シンボル）

以下の公開シンボルには JSDoc を必ず付与する:

- `export` された関数・クラス・メソッド・型（`type` / `interface`）・定数
- React/Vue コンポーネントの **props 型**（各プロパティに説明）
- カスタムフック（`useXxx`）・composable（`useXxx`）
- 公開 API のハンドラー・サービスメソッド

**任意対象**: `export` されない内部関数、および処理が自明な 1 行ユーティリティ。ただし意図が非自明なものは内部でも付与する。

## 混乱テスト（公開/内部・本番/テストを問わない）

判断軸は「public か否か」ではなく **「1 か月後の自分／他プロジェクト帰りの読み手が『これは何？なぜ？』となるか」**。なるなら、内部関数でもテストコードでも "why" を残す。

- **キャスト・回避策には "why" 必須**: `as unknown as` / `as any` / `@ts-ignore` / `@ts-expect-error` / マジック値 / 複雑な正規表現 / 明示的なワークアラウンド。**型を欺く・仕様を迂回する箇所は、その根拠（なぜ安全か／なぜ必要か）がコードから消える**ため、コメントが唯一の記録になる。
  - 例: テストダブルを `repo as unknown as Repository<Task>` で注入する場合、「ダブルは対象が実際に呼ぶメソッドだけの部分実装で、実型は構造的に大きいため二段キャストで隙間を埋める（実行時は使う分だけで足りる）」と残す。
- **テスト足場**（SUT ビルダー・複雑な fixture・非自明な mock）も、意図が読み取りにくいなら付ける。

## 記述ルール

- **型は書かない**: 型は TypeScript のシグネチャが唯一の真実（source of truth）。JSDoc に `{string}` 等の型ブレースを併記しない（二重管理・型ずれの原因になる）。JSDoc は**意図・意味・制約**を日本語で記述する。
- **要約行必須**: 1 行目にそのシンボルが「何をするか」を簡潔に書く。
- **`@param` 必須**: 全引数に `@param name - 説明` を記述する。オプション引数・デフォルト値の意味も明記する。
- **`@returns` 必須**: 戻り値がある場合は `@returns 説明` を記述する（`void` / JSX 返却のコンポーネントは省略可）。
- **`@throws` 必須**: 意図的に例外を投げる場合は `@throws {ErrorType} 発生条件` を記述する。
- **補助タグ（任意）**: `@example` `@deprecated` `@see` は必要に応じて使う。

## 例

```ts
/**
 * ユーザー ID から表示名を解決する。キャッシュに無ければ API を叩く。
 *
 * @param userId - 対象ユーザーの UUID
 * @param opts - 解決オプション（`force` 指定でキャッシュを無視）
 * @returns 表示名。ユーザーが存在しない場合は `null`
 * @throws {ApiError} API 通信に失敗した場合
 */
export async function resolveDisplayName(
  userId: string,
  opts?: { force?: boolean },
): Promise<string | null> {
  // ...
}
```

## Lint による強制（導入済み）

`eslint-plugin-jsdoc`（`mode: "typescript"`）を `front/eslint.config.mjs` に導入済み。**有効ルールの唯一の真実は同ファイル**（このドキュメントは方針、設定は実体）。`pnpm lint` で検出する。

- **対象**: `src/**/*.{ts,tsx}`。
- **方針**: `require-jsdoc` は未採用。JSDoc ブロックを**持つ**関数の品質のみを検査する（未文書化の関数を一斉にエラーにはせず、段階導入を可能にする）。ブロックの有無・要否はレビューで担保する。
- **型ブレース禁止**: `jsdoc/no-types` を error（型は TS シグネチャが唯一の真実。`require-param-type` / `require-returns-type` 相当は付与しない）。
- **`@param`**: `require-param` / `require-param-description` / `check-param-names` を error（分割代入 props は `checkDestructured: false` で props.x 単位に展開しない）。
- **`@returns`**: `require-returns` / `require-returns-description` を error。ただし JSX を返す `.tsx` コンポーネントでは off（「〜の要素を返す」はノイズのため。`.ts` のフック / lib / API では必須のまま）。
- **体裁**: `check-alignment` / `no-multi-asterisks` を warn。
