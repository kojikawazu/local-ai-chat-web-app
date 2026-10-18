---
description: GitHub Actions ワークフロー規約（最小権限・concurrency・トリガーの同期・actionlint）
globs: ".github/workflows/**"
---

# GitHub Actions ワークフロー規約

`.github/workflows/` のワークフローを追加・変更するときの規約。CI の構成（どのジョブが何を検査するか・発火条件）は `testing.md` を参照。

## ワークフロー一覧

| ファイル | 内容 | 発火条件 |
|---|---|---|
| `quality.yml` | lint / format:check / typecheck | ドキュメントのみの変更では発火しない（`paths-ignore`） |
| `unit-test.yml` | UT | 同上 |
| `integration-test.yml` | IT（Testcontainers） | 同上 |
| `e2e-test.yml` | E2E（Ollama + PostgreSQL） | 同上 |
| `workflow-lint.yml` | actionlint・トリガー定義の一致検査 | **常時実行**（パスの絞り込みなし） |

## 必須設定

全ワークフローに以下を置く。

- **`permissions` を最小権限で明示する。** 現状はすべて `contents: read`（チェックアウトと検査のみ）。省略すると既定の広い権限で動く。書き込みが必要なジョブを足す場合は、そのジョブにだけ必要な権限を付ける。
- **`concurrency` を置く。** 形は以下で統一する。

  ```yaml
  concurrency:
    group: ${{ github.workflow }}-${{ github.ref }}
    cancel-in-progress: ${{ github.event_name == 'pull_request' }}
  ```

  - `group` に `github.workflow` を含めるため、ワークフロー同士が互いをキャンセルすることはない。
  - **キャンセルは PR のときだけ**。同じ PR への連続 push では古い実行を止めて E2E 等の積み上がりを防ぐ。main への push は止めず、マージコミットごとに結果を残す（`true` にすると、続けてマージしたときにどのマージで壊れたか追えなくなる）。
- **`timeout-minutes` をジョブに置く。** 止まったジョブが既定の 6 時間走り続けないようにする。

## トリガー定義（`on:`）の同期

- `quality` / `unit-test` / `integration-test` / `e2e-test` の 4 本の `on:`（`paths-ignore` を含む）は**同一に保つ**。除外パターンを増減するときは 4 本を同時に直す。
- GitHub Actions にはトリガー定義だけを共有する仕組みが無い（`workflow_call` は呼び出し側にもトリガーが要る）ため、重複は許容し、**一致を `workflow-lint.yml` の「Check trigger consistency」が機械検査する**。直し漏れると Workflow Lint が落ちる。
- 除外パターンの内容（何を除外するか）は `testing.md`「CI の発火条件」が唯一の真実。

## 常時実行のワークフロー

- 秒単位で終わる検査（`workflow-lint.yml`、今後の Secret scan 等）には**パスの絞り込み（`paths` / `paths-ignore`）を付けない**。
  - どの変更でも検査対象になりうるうえ、required status check に指定した場合にパスの絞り込みがあると「報告なし」のまま PR がマージ不能になるため。

## actionlint

- `workflow-lint.yml` で**公式 Docker イメージをタグで固定**して実行する（`rhysd/actionlint:<version>`）。
  - イメージには shellcheck / pyflakes が同梱され、`run:` のシェルも検査される。バイナリ単体や `brew install` 版では shellcheck が無いと `run:` の検査が警告も出さずにスキップされ、終了コードは 0 のままになるため使わない。
- ローカルで確認する場合も同じイメージを使う: `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:<version> -color`（リポジトリのルートで実行）

## バージョンの固定

- ツール・ランタイムは `latest` を使わず固定する（破壊的に上がるため）。固定した理由はワークフロー内のコメントに残す（Node 20 / 22、pnpm 10、Ollama 0.30.7 等の既存の固定と同じ扱い）。

## 将来 required status check を入れる場合

現状 main に branch protection は無い。required status check を導入する場合、`paths-ignore` でスキップされたワークフローは「報告なし」になり PR がマージ不能になる。そのときは**変更判定ジョブ（`changes`）+ ジョブレベルの `if:`** に構成を移す（ワークフローは常に起動し、ジョブ単位でスキップすると "skipped" として報告される）。

## レビュー観点

- 追加・変更したワークフローに `permissions` があるか
- 追加・変更したワークフローに `concurrency`（上記の形）があるか
- ジョブに `timeout-minutes` があるか
- 4 本の `on:` を変えた場合、4 本とも同じに変えたか
- 常時実行の検査にパスの絞り込みを付けていないか
- `run:` に外部入力（PR タイトル・本文・ブランチ名等の `github.event.*`）を `${{ }}` で直接埋め込んでいないか（`env:` 経由で渡す）
