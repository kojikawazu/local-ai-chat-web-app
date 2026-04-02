# Nordic Chat セットアップガイド（macOS）

ローカルLLM（Ollama）と対話するチャットWebアプリケーション「Nordic Chat」を、macOS上でゼロから構築する手順です。

## 目次

1. [前提条件の確認](#1-前提条件の確認)
2. [Homebrewのインストール](#2-homebrewのインストール)
3. [Node.js と pnpm のインストール](#3-nodejs-と-pnpm-のインストール)
4. [Docker Desktop のインストール](#4-docker-desktop-のインストール)
5. [Ollama のインストールとモデル取得](#5-ollama-のインストールとモデル取得)
6. [リポジトリのクローン](#6-リポジトリのクローン)
7. [PostgreSQL の起動](#7-postgresql-の起動)
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
| メモリ | 8GB以上（16GB推奨。LLMモデルのサイズに依存） |
| ディスク | 10GB以上の空き容量（モデルサイズに依存） |

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

Ollama が起動中の状態で、モデルをダウンロードします。

```bash
# デフォルトモデル（qwen3-coder）をダウンロード
ollama pull qwen3-coder:latest
```

> **注意**: モデルのダウンロードには数分〜数十分かかります（ファイルサイズ: 約4-8GB）。
> 回線速度やモデルサイズにより異なります。

#### 他のモデルを使いたい場合

任意のモデルをダウンロードできます。アプリ内でモデルを切り替え可能です。

```bash
# 例: 軽量モデル
ollama pull gemma3:4b

# 例: 高性能モデル（メモリ16GB以上推奨）
ollama pull llama3.1:8b
```

利用可能なモデルは [Ollama Library](https://ollama.ai/library) で確認できます。

### Ollama の動作確認

```bash
# モデル一覧を確認（ダウンロード済みモデルが表示される）
ollama list

# 動作テスト（応答が返ればOK。Ctrl+Dで終了）
ollama run qwen3-coder:latest "Hello"
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

## 7. PostgreSQL の起動

プロジェクトルートディレクトリで実行します。

```bash
# PostgreSQLコンテナを起動
docker compose up -d
```

起動確認:

```bash
# コンテナの状態を確認（STATUSが「Up」であればOK）
docker compose ps
```

以下のように表示されれば成功です:

```
NAME       IMAGE         STATUS         PORTS
chat_db    postgres:16   Up ...         0.0.0.0:5499->5432/tcp
```

---

## 8. アプリケーションのセットアップ

### 依存パッケージのインストール

```bash
cd front
pnpm install
```

### 環境変数の設定

```bash
# 環境変数ファイルを作成
cat <<'EOF' > .env.local
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3-coder:latest
DATABASE_URL=postgresql://postgres:postgres@localhost:5499/chat_db
EOF
```

> **補足**: デフォルトモデルを変更したい場合は `OLLAMA_MODEL` の値を変更してください。
> アプリ内のUIからもモデルを切り替えられます。

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

### PostgreSQL の停止

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
- [ ] `docker compose ps` で PostgreSQL が `Up` 状態
- [ ] Ollama が起動中（メニューバーにアイコン表示）
- [ ] `ollama list` でモデルがダウンロード済み
- [ ] `pnpm dev` で開発サーバーが起動
- [ ] `http://localhost:3000` にアクセスできる
- [ ] メッセージを送信してAIから応答が返る
