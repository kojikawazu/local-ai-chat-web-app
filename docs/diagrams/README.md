# 構成図（draw.io）

> 最終更新: 2026-10-31

全体の構成と、Ollama とアプリ（Next.js）の責務の分担を draw.io で描いた図。正準は `architecture.drawio`（1 ファイル・5 ページ）で、PNG はそこから書き出した閲覧用の写し。

## ページ

| # | ページ | PNG | 内容 |
|---|---|---|---|
| 1 | 全体アーキテクチャ | [01-architecture.png](./01-architecture.png) | ブラウザ・Next.js サーバー（Route Handlers・Agent Loop・ツール・プロキシ・Prisma）・ホストのプロセス（Ollama・ファイル・コマンド・`gh`・Chromium）・Docker Compose・インターネット。実行前に承認が要るツールは橙 |
| 2 | Ollama とアプリの責務（パターン表） | [02-ollama-responsibilities.png](./02-ollama-responsibilities.png) | 10 のパターン（通常のチャット・画像・計算・Web・ファイルの読み取り / 書き込み・コマンド・GitHub・ブラウザ・タイトル）ごとに、Ollama がすること・アプリがすること・承認・その後の応答への制約・対応するシーケンス |
| 3 | シーケンス A 基本の往復 | [03-sequence-a-basic.png](./03-sequence-a-basic.png) | 通常のチャット・画像の添付・タイトルの生成（ツールなし） |
| 4 | シーケンス B ツールの往復 | [04-sequence-b-tools.png](./04-sequence-b-tools.png) | 承認なしのツール。エージェントのループ（最大 10 ラウンド）の骨格 |
| 5 | シーケンス C 承認を挟む往復 | [05-sequence-c-approval.png](./05-sequence-c-approval.png) | ファイルの書き込み・コマンド・GitHub への投稿・ブラウザの操作。準備 → 承認 → 実行 |

色: 緑は Ollama、青は Web アプリ（Next.js サーバー）、紫はブラウザ（シーケンスのみ）、橙は利用者の承認が絡むもの。

## 更新のしかた

1. `architecture.drawio` を draw.io（デスクトップ版・Web 版・VS Code の拡張）で開いて編集する。
2. 変更したページの PNG を書き出し直す（draw.io のデスクトップ版の CLI。`-p` はページの番号で 1 始まり）。

   ```bash
   cd docs/diagrams
   drawio -x -f png -s 1.2 -b 10 -p 1 -o 01-architecture.png architecture.drawio
   drawio -x -f png -s 1.2 -b 10 -p 2 -o 02-ollama-responsibilities.png architecture.drawio
   drawio -x -f png -s 1.2 -b 10 -p 3 -o 03-sequence-a-basic.png architecture.drawio
   drawio -x -f png -s 1.2 -b 10 -p 4 -o 04-sequence-b-tools.png architecture.drawio
   drawio -x -f png -s 1.2 -b 10 -p 5 -o 05-sequence-c-approval.png architecture.drawio
   ```

3. 図の中身はコードとドキュメントの写しなので、次の変更をしたときは図も直す。
   - ツール・Route Handler・Docker Compose のサービスの追加・削除（1・2 ページ）
   - 承認・応答への制約（外部と通信するツールを止める条件）の変更（2・4・5 ページ）
   - `/api/chat` の流れ・NDJSON のイベントの変更（3〜5 ページ）
