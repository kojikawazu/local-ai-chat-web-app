# Nordic Chat セットアップガイド（macOS）

> 最終更新: 2026-10-30

ローカルLLM（Ollama）と対話するチャットWebアプリケーション「Nordic Chat」を、macOS上でゼロから構築する手順です。

## 目次

1. [前提条件の確認](#1-前提条件の確認)
2. [Homebrewのインストール](#2-homebrewのインストール)
3. [Node.js と pnpm のインストール](#3-nodejs-と-pnpm-のインストール)
4. [Docker Desktop のインストール](#4-docker-desktop-のインストール)
5. [Ollama のインストールとモデル取得](#5-ollama-のインストールとモデル取得)
6. [リポジトリのクローン](#6-リポジトリのクローン)
7. [PostgreSQL・SearXNG・PlantUML の起動](#7-postgresqlsearxngplantuml-の起動)
8. [アプリケーションのセットアップ](#8-アプリケーションのセットアップ)
9. [アプリケーションの起動](#9-アプリケーションの起動)
10. [動作確認](#10-動作確認)
11. [停止方法](#11-停止方法)
12. [トラブルシューティング](#12-トラブルシューティング)

---

## 1. 前提条件の確認

| 項目 | 要件 |
|------|------|
| OS | macOS 13 (Ventura) 以降 |
| CPU | Apple Silicon (M1/M2/M3/M4) または Intel |
| メモリ | 使用するLLMモデルに依存。軽量モデル（数GB級）なら 8〜16GB、デフォルトの `qwen3.8:27b`（27B、読み込み時 約 17GB）は **32GB以上のRAM/VRAMを推奨** |
| ディスク | 使用するモデルのサイズ分の空き容量。デフォルトモデルは **約18GB**、軽量モデルなら数GB |

> **モデル選びの目安**: 初めての場合や 8〜16GB のマシンでは、まず軽量モデル（例: `gemma3:4b`）で動作確認することを強く推奨します。デフォルトの `qwen3.8:27b` は高性能ですが大きく、低スペック機では動作しません。モデルはアプリ内およびUIからいつでも切り替えられます。

ターミナルアプリ（Terminal.app または iTerm2 等）を開いて、以降の手順を実行してください。

---

## 2. Homebrewのインストール

macOS用パッケージマネージャー。既にインストール済みの場合はスキップしてください。

```bash
# Homebrewがインストール済みか確認
brew --version
```

インストールされていない場合:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

インストール完了後、ターミナルに表示される指示に従いPATHを設定してください。
Apple Siliconの場合は以下が表示されます:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

---

## 3. Node.js と pnpm のインストール

### Node.js のインストール

Node.js 20以上が必要です。

```bash
# Node.jsがインストール済みか確認
node --version
```

インストールされていない場合（Homebrew経由）:

```bash
brew install node
```

> **補足**: nvm や volta 等のバージョンマネージャーを使用している場合はそちらでNode.js 20以上をインストールしてください。

### pnpm のインストール

```bash
# pnpmがインストール済みか確認
pnpm --version
```

インストールされていない場合:

```bash
# corepack経由（推奨）
corepack enable
corepack prepare pnpm@latest --activate
```

または:

```bash
# Homebrew経由
brew install pnpm
```

---

## 4. Docker Desktop のインストール

PostgreSQLをDockerコンテナで起動します。

```bash
# Dockerがインストール済みか確認
docker --version
```

インストールされていない場合:

1. [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/) からダウンロード
2. `.dmg` ファイルを開き、Docker.app を Applications フォルダにドラッグ
3. Docker Desktop を起動し、初回セットアップを完了させる

```bash
# Docker Composeも確認（Docker Desktopに同梱）
docker compose version
```

> **重要**: Docker Desktop が起動中（メニューバーにDockerアイコンが表示されている状態）でないと `docker compose` コマンドが使えません。

---

## 5. Ollama のインストールとモデル取得

### Ollama のインストール

```bash
# Ollamaがインストール済みか確認
ollama --version
```

インストールされていない場合:

1. [https://ollama.ai/](https://ollama.ai/) からmacOS版をダウンロード
2. `.dmg` ファイルを開き、Ollama.app を Applications フォルダにドラッグ
3. Ollama を起動（メニューバーにアイコンが表示される）

または Homebrew 経由:

```bash
brew install ollama
```

### LLMモデルのダウンロード

Ollama が起動中の状態で、モデルをダウンロードします。**使用するモデルに合わせて `front/.env.local` の `OLLAMA_MODEL` を設定してください**（手順8で設定）。

**おすすめ（初回・8〜16GBマシン）— 軽量モデル:**

```bash
# 軽量モデル（約3GB）。まずはこれで動作確認するのが安全
ollama pull gemma3:4b
```

**アプリのデフォルトモデル（大型・高性能）:**

```bash
# qwen3.8:27b（27B）
ollama pull qwen3.8:27b
```

> **注意**: `qwen3.8:27b` は **約18GB** あり、ダウンロードに時間がかかるうえ実行に **32GB以上のRAM/VRAM** を推奨します（読み込み時 約 17GB）。低スペック機では上の軽量モデルを使用してください。
> `qwen3.8` は **Ollama 0.32.12 以上**が必要です（`ollama --version` で確認。0.40.5 で動作確認済み）。古い場合は Ollama を最新版に更新してください。各モデルの特徴は [`docs/models/`](../docs/models/README.md) を参照。
> ダウンロード時間は回線速度・モデルサイズにより数分〜数十分かかります。

#### 他のモデルを使いたい場合

任意のモデルをダウンロードできます。アプリ内でモデルを切り替え可能です。

```bash
# 例: さらに軽量（約815MB）
ollama pull gemma3:1b

# 例: 中量級（メモリ16GB以上推奨、約4.9GB）
ollama pull llama3.1:8b
```

利用可能なモデルは [Ollama Library](https://ollama.ai/library) で確認できます。

#### E2E テストを実行する場合（開発者向け）

E2E テスト（`pnpm test:e2e`）は、アプリの設定とは別に**軽量モデル `qwen2.5:0.5b`（約 400MB）**を使います。大型モデルを E2E で読み込むとメモリを大きく消費するためです。

```bash
ollama pull qwen2.5:0.5b
```

> 大型モデルで E2E を実行したい場合は `E2E_OLLAMA_MODEL=qwen3.8:27b pnpm test:e2e` のように指定します。

### Ollama の動作確認

```bash
# モデル一覧を確認（ダウンロード済みモデルが表示される）
ollama list

# 動作テスト（ダウンロードしたモデル名を指定。応答が返ればOK。Ctrl+Dで終了）
ollama run gemma3:4b "Hello"
```

---

## 6. リポジトリのクローン

```bash
# 任意のディレクトリに移動
cd ~/developer  # 例: ホームディレクトリ配下

# リポジトリをクローン
git clone git@github.com:kojikawazu/local-ai-chat-web-app.git

# プロジェクトディレクトリに移動
cd local-ai-chat-web-app
```

> **補足**: SSHキーが設定されていない場合はHTTPS経由でもクローンできます:
> ```bash
> git clone https://github.com/kojikawazu/local-ai-chat-web-app.git
> ```

---

## 7. PostgreSQL・SearXNG・PlantUML の起動

プロジェクトルートディレクトリで実行します。会話履歴を保存する PostgreSQL、Web検索（エージェントの `web_search` ツール）に使う SearXNG、応答の PlantUML の図を描く PlantUML サーバーが起動します。

```bash
# PostgreSQL・SearXNG・PlantUML のコンテナを起動
docker compose up -d
```

起動確認:

```bash
# コンテナの状態を確認（STATUSが「Up」であればOK）
docker compose ps
```

以下のように表示されれば成功です:

```
NAME           IMAGE                                 STATUS    PORTS
chat_db        postgres:16                           Up ...    0.0.0.0:5499->5432/tcp
chat_searxng   searxng/searxng:2026.10.2-a5659a536   Up ...    127.0.0.1:8888->8080/tcp
chat_plantuml  plantuml/plantuml-server:jetty-v1.2026.8   Up ...    127.0.0.1:8889->8080/tcp
```

SearXNG はブラウザで `http://localhost:8888` を開くと検索画面が表示されます（この PC の中からだけアクセスできます）。

PlantUML サーバーは、外部の URL・ファイルの読み込み（`!include https://…` 等）を止めた設定（`PLANTUML_SECURITY_PROFILE=SANDBOX`）で起動します。同梱の標準ライブラリ（`!include <C4/C4_Container>` 等）は使えます。

---

## 8. アプリケーションのセットアップ

### 依存パッケージのインストール

```bash
cd front
pnpm install
```

### 環境変数の設定

```bash
# 環境変数ファイルを作成（OLLAMA_MODEL は手順5でダウンロードしたモデル名に合わせる）
cat <<'EOF' > .env.local
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:4b
DATABASE_URL=postgresql://postgres:postgres@localhost:5499/chat_db
SEARXNG_URL=http://localhost:8888
PLANTUML_URL=http://localhost:8889
EOF
```

> **重要**: `OLLAMA_MODEL` は **実際に `ollama pull` したモデル名と一致させてください**（一致しないと「モデルが見つからない」エラーになります）。
> アプリのデフォルトは `qwen3.8:27b` ですが、軽量モデルで動作確認する場合は上記のように使用モデルを指定します。アプリ内のUIからもモデルを切り替えられます。
>
> なお `front/.env.example` をコピーして作成することもできます: `cp .env.example .env.local`
>
> **任意**: エージェントにローカルのファイルを探して読ませる場合は、読んでよいフォルダを `LOCAL_FILE_ROOTS` に絶対パス（カンマ区切り・`~` 可）で足します（例: `LOCAL_FILE_ROOTS=~/developer/my-project`）。未設定ならファイルのツールは使われません。プロジェクトのフォルダなど必要な範囲だけを指定してください（`docs/14-local-file-tools.md`）。
>
> **任意**: ファイルの作成・編集もさせる場合は、書いてよいフォルダを `LOCAL_FILE_WRITE_ROOTS` に足します（`LOCAL_FILE_ROOTS` の中だけ。例: `LOCAL_FILE_WRITE_ROOTS=~/developer/my-project`）。書き込みのたびに画面に差分が出て、許可するまで書かれません（`docs/15-tool-approval.md`）。
>
> **任意**: コマンド（テスト・`git status` 等）も実行させる場合は、実行してよいプログラムの名前を `LOCAL_COMMANDS` に足します（例: `LOCAL_COMMANDS=git,pnpm`）。作業フォルダは `LOCAL_FILE_WRITE_ROOTS` の中だけで、実行のたびに画面にコマンドが出て、許可するまで実行されません。書いたプログラムは何でも実行できる前提で選んでください（`node`・`pnpm` は任意のコードを実行できます。`curl` など外へ送るものは書かないでください）。実行時間の上限は `LOCAL_COMMAND_TIMEOUT_MS`（既定 120 秒）です（`docs/16-command-execution.md`）。
>
> **任意**: GitHub の PR・issue を読ませ、コメント・PR の作成もさせる場合は、GitHub CLI を入れてログインし（`brew install gh` → `gh auth login`）、扱ってよいリポジトリを `GITHUB_REPOS` に `owner/name` のカンマ区切りで足します（例: `GITHUB_REPOS=your-name/your-repo`）。読むときは承認なしで、コメント・PR の作成のたびに画面に本文が出て、許可するまで送られません。トークンを `.env.local` に書く必要はありません。`gh` を `LOCAL_COMMANDS` に書く必要もなく、書くと `gh api` などまで承認 1 回で使えるため、書かないでください（`docs/17-github-tools.md`）。
>
> **任意**: ブラウザでページを開いて読ませる（JavaScript で描くページ・開発中のアプリの画面）場合は、`front` で `pnpm exec playwright install chromium` を実行して Chromium を入れ、`BROWSER_ENABLED=true` を足します。手元の開発サーバーを開かせるなら、そのオリジンを `BROWSER_LOCAL_ORIGINS` に足します（例: `BROWSER_LOCAL_ORIGINS=http://localhost:5173`）。ほかの手元のサービス（PostgreSQL・Ollama 等）とこのアプリ自身は開けません。読み取りだけで、クリック・入力はしません（`docs/18-browser-tools.md`）。

### データベースのマイグレーション

```bash
# Prismaマイグレーションを実行（テーブルを作成）
pnpm prisma migrate dev
```

`Enter a name for the new migration:` と聞かれた場合は `init` と入力してEnterを押してください。
（既にマイグレーションファイルが存在する場合は自動的に適用されます）

---

## 9. アプリケーションの起動

```bash
# 開発サーバーを起動
pnpm dev
```

以下のように表示されれば起動成功です:

```
  ▲ Next.js 16.x.x
  - Local:    http://localhost:3000
  - Network:  http://xxx.xxx.xxx.xxx:3000

 ✓ Ready in xxxms
```

---

## 10. 動作確認

### ブラウザでアクセス

ブラウザで以下のURLを開いてください:

```
http://localhost:3000
```

Nordic Frostデザインのチャット画面が表示されます。

### 基本操作

1. **チャット開始**: 画面下部の入力欄にメッセージを入力し、Enterキーまたは送信ボタンをクリック
2. **新規会話**: サイドバーの「New Conversation」ボタンをクリック
3. **会話切替**: サイドバーの会話一覧から選択
4. **モデル変更**: ヘッダーのドロップダウンから選択、または設定画面から変更
5. **テーマ変更**: サイドバー下部の設定ボタン → テーマ選択
6. **改行**: Shift + Enter

---

## 11. 停止方法

### アプリケーションの停止

開発サーバーが動作しているターミナルで `Ctrl + C` を押してください。

### PostgreSQL・SearXNG・PlantUML の停止

```bash
# プロジェクトルートディレクトリで実行
cd /path/to/local-ai-chat-web-app
docker compose down
```

> **注意**: `docker compose down` はコンテナを停止・削除しますが、データは保持されます（Docker volumeに保存）。
> データも完全に削除したい場合は `docker compose down -v` を実行してください。

### Ollama の停止

メニューバーのOllamaアイコンをクリックし、「Quit Ollama」を選択してください。

---

## 12. トラブルシューティング

### Ollama に接続できない

```
Ollamaへの接続に失敗しました
```

**対処法:**

```bash
# Ollamaが起動しているか確認
curl http://localhost:11434/api/tags

# 起動していない場合、Ollama.appを起動するか以下を実行
ollama serve
```

### PostgreSQL に接続できない

```
Can't reach database server at `localhost:5499`
```

**対処法:**

```bash
# Dockerコンテナが起動しているか確認
docker compose ps

# 停止している場合は再起動
docker compose up -d

# ポートが別プロセスに使用されていないか確認
lsof -i :5499
```

### Web検索の結果が返らない

エージェントの Web検索で「SearXNG（http://localhost:8888）に接続できません」と表示される場合は、SearXNG が起動していません。

**対処法:**

```bash
# プロジェクトルートで、コンテナの状態を確認（chat_searxng が Up か）
docker compose ps

# 停止している場合は起動
docker compose up -d

# JSON の API が応答するか確認（results に結果が入っていれば OK）
curl -s "http://localhost:8888/search?q=test&format=json" | head -c 300
```

「検索エンジンが応答しませんでした」と表示される場合は、SearXNG が問い合わせる検索エンジン側の一時的な制限です（アクセスが続くと止められます）。しばらく時間をおいてから質問し直してください。同じ応答の中では、エージェントは検索し直しません（止められる時間を延ばさないため）。

どのエンジンが応答していないかは、次で確かめられます。`unresponsive_engines` に理由（`too many requests`・`CAPTCHA` 等）が出ます。

```bash
curl -s "http://localhost:8888/search?q=test&format=json" | python3 -c 'import sys,json; print(json.load(sys.stdin)["unresponsive_engines"])'
```

### PlantUML の図が表示されない

PlantUML のコードブロックの下に「図を描けませんでした: PlantUML サーバーに接続できませんでした」と表示される場合は、PlantUML サーバーが起動していません。

**対処法:**

```bash
# プロジェクトルートで、コンテナの状態を確認（chat_plantuml が Up か）
docker compose ps

# 停止している場合は起動
docker compose up -d

# 図を描けるか確認（HTTP 200 と表示されれば OK）
printf 'A -> B\n' | curl -s -X POST --data-binary @- -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:8889/svg
```

「Cannot open URL」「cannot include」と表示される場合は、外部の URL・ファイルの読み込みを止めているためです（安全のための設定。同梱の標準ライブラリは使えます）。

### pnpm install でエラーが出る

```bash
# Node.jsのバージョンを確認（20以上が必要）
node --version

# キャッシュをクリアして再実行
pnpm store prune
rm -rf node_modules
pnpm install
```

### Prisma マイグレーションでエラーが出る

```bash
# PostgreSQLが起動中か確認
docker compose ps

# .env.local のDATABASE_URLが正しいか確認
cat .env.local

# Prismaクライアントを再生成
pnpm prisma generate

# マイグレーションをリセット（データは削除されます）
pnpm prisma migrate reset
```

### モデルのダウンロードが遅い・失敗する

```bash
# ダウンロード状況を確認
ollama list

# 軽量なモデルで試す（約2GB）
ollama pull gemma3:1b
```

その後、`front/.env.local` の `OLLAMA_MODEL` を変更:

```
OLLAMA_MODEL=gemma3:1b
```

### ポート3000が既に使用されている

```bash
# ポート3000を使用しているプロセスを確認
lsof -i :3000

# 別のポートで起動
pnpm dev -- -p 3001
```

### Apple Silicon (M1/M2/M3/M4) での注意点

- Docker Desktop は Apple Silicon ネイティブ対応済みです
- Ollama も Apple Silicon ネイティブ対応済みです。GPUアクセラレーションが自動で有効になります
- 一部のnpmパッケージでネイティブバイナリのビルドが必要な場合があります。Xcode Command Line Toolsをインストールしてください:

```bash
xcode-select --install
```

---

## 起動チェックリスト

セットアップ完了後、以下を確認してください:

- [ ] Docker Desktop が起動中
- [ ] `docker compose ps` で PostgreSQL・SearXNG・PlantUML が `Up` 状態
- [ ] Ollama が起動中（メニューバーにアイコン表示）
- [ ] `ollama list` でモデルがダウンロード済み
- [ ] `pnpm dev` で開発サーバーが起動
- [ ] `http://localhost:3000` にアクセスできる
- [ ] メッセージを送信してAIから応答が返る
