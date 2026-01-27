# CI E2Eテスト バグレポート

GitHub Actions での E2E テスト導入時に発生した不具合と対応をまとめる。

## 環境

| 項目 | 値 |
|------|-----|
| CI | GitHub Actions (`ubuntu-latest`) |
| ブラウザ | Chromium (headless) |
| テストフレームワーク | Playwright |
| LLM | Ollama (`qwen2.5:0.5b`) |
| DB | PostgreSQL 16 (service container) |

---

## 1. ディスク容量不足

**症状**: Ollama モデル pull 時に `no space left on device`

**原因**: 当初使用した `qwen3-coder:latest`（約18GB）が CI ランナーの空きディスクを超過。

**対応**:
- モデルを軽量な `qwen3:0.6b`（約500MB）に変更
- 不要なプリインストール SDK を削除するステップを追加
  ```yaml
  sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /opt/hostedtoolcache
  ```

**ファイル**: `.github/workflows/e2e-test.yml`

---

## 2. Prisma クライアント未生成

**症状**: `Module not found: Can't resolve '@/generated/prisma/client'`

**原因**: `src/generated/prisma/` は `.gitignore` で除外されているため、CI 上にクライアントコードが存在しない。

**対応**: ビルド前に `pnpm prisma generate` ステップを追加。

**ファイル**: `.github/workflows/e2e-test.yml`

---

## 3. ウェルカムテキストの不一致（18テスト中5件）

**症状**: `getByText('Welcome to Nordic.')` が要素を見つけられない。

**原因**: Phase 7 でウェルカム画面のテキストが日本語（`Nordic Chat へようこそ`）に変更されたが、テストコードが未更新だった。

**対応**: 全テストファイルのウェルカムテキスト参照を日本語に更新。

**ファイル**: `chat.spec.ts`, `sidebar.spec.ts`, `screenshot.spec.ts`, `debug-console.spec.ts`

---

## 4. Clipboard API がヘッドレス環境で使用不可（3件）

**症状**: `fillTextarea` ヘルパーで `navigator.clipboard.writeText()` が権限エラー。

**原因**: ヘッドレス Chromium ではユーザージェスチャーなしに Clipboard API を使用できない。

**対応**: クリップボード貼り付けの代わりに `nativeInputValueSetter` + `dispatchEvent` で直接 DOM 値を設定する方式に変更。

```typescript
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype,
  'value'
)?.set;
nativeInputValueSetter?.call(el, text);
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

**ファイル**: `front/tests/e2e/helpers/test-data.ts`

---

## 5. 新規会話ボタンの初期状態（3件）

**症状**: サイドバーの「新しい会話」ボタンが disabled で操作できない。

**原因**: 初期表示時に `currentConversationId = null` のため、ボタンが無効化される仕様。テストは会話が選択された状態を前提としていた。

**対応**: テストで先に会話を作成・選択してからボタン操作を行うよう修正。

**ファイル**: `front/tests/e2e/sidebar.spec.ts`

---

## 6. `getByText` strict mode 違反（2件）

**症状**: `getByText('Nordic Chat')` や `getByText('メッセージ 10')` が複数要素にマッチし strict mode エラー。

**原因**:
- `'Nordic Chat'` はヘッダーとサイドバーの両方に存在
- `'メッセージ 10'` はメッセージバブルとその親コンテナの両方にマッチ

**対応**:
- `getByRole('heading', { name: 'Nordic Chat', exact: true })` に変更
- `getByText('メッセージ 10', { exact: true }).first()` に変更

**ファイル**: `front/tests/e2e/responsive.spec.ts`, `front/tests/e2e/chat.spec.ts`

---

## 7. スクリーンショットベースラインの OS 差異（3件）

**症状**: スクリーンショット比較でベースライン画像が見つからない。

**原因**: ベースライン画像は macOS (darwin) で生成されたものだけが存在し、CI の Linux (chromium-linux) 用ベースラインがない。フォントレンダリングの差異により OS 間でピクセル一致しない。

**対応**: スクリーンショットテストを CI 環境ではスキップ。

```typescript
test.skip(!!process.env.CI, 'スクリーンショットテストはCI環境ではスキップ');
```

**ファイル**: `front/tests/e2e/screenshot.spec.ts`

---

## 8. テストタイムアウトと expect タイムアウトの不整合（4件）

**症状**: `expect().toBeVisible({ timeout: 120000 })` を設定しているが、テスト自体が30秒（デフォルト）でタイムアウト。

**原因**: Playwright のデフォルトテストタイムアウト（30秒）が、expect のタイムアウト（120秒）より短い。

**対応**: LLM 応答を待つテストスイートに `test.setTimeout(180000)` を追加。

**ファイル**: `front/tests/e2e/chat.spec.ts`, `front/tests/e2e/chat-streaming.spec.ts`

---

## 9. ストリーミング完了タイムアウト（4件）

**症状**: `expect(sendButton).toBeEnabled({ timeout: 120000 })` が120秒経過してもタイムアウト。送信ボタンが disabled のまま。

**原因**: CI ランナー（CPU only）では LLM の推論が非常に遅い。`qwen3:0.6b` は思考モード（`<think>` トークン）により応答が長大化。`qwen2.5:0.5b`（思考モードなし）に変更しても、CPU のみでは120秒以内にストリーミングが完了しない。

**対応**:
- CI モデルを `qwen2.5:0.5b`（思考モードなし）に変更
- ストリーミング**完了**を待つ4テストは CI でスキップ
- ストリーミング**開始**テスト（AI応答コンテナの表示確認）は CI でも実行

```typescript
test.skip(!!process.env.CI, 'CI環境(CPU only)ではストリーミング完了まで時間がかかりすぎるためスキップ');
```

**ファイル**: `.github/workflows/e2e-test.yml`, `front/tests/e2e/chat-streaming.spec.ts`

---

## 10. Shift+Enter テストでメッセージが送信される（1件）

**症状**: `textarea.press('Shift+Enter')` 後にメッセージバブル（`bg-nord-frost-2`）が1件検出される。メッセージが送信されてしまっている。

**原因**: CI の headless Chromium 環境で `press('Shift+Enter')` の Shift 修飾キーが正しく認識されず、Enter のみとして処理される可能性がある。

**対応**:
- キーボード操作を明示的に分離: `keyboard.down('Shift')` → `keyboard.press('Enter')` → `keyboard.up('Shift')`
- 各操作間に `waitForTimeout(200)` を挿入
- アサーションを「メッセージバブルが0件」から「textarea に入力テキストが残っている」に変更（送信されれば textarea はクリアされるため、より本質的な検証）
- テスト入力を日本語から ASCII（`Line1` / `Line2`）に変更し、IME の影響を排除

**ファイル**: `front/tests/e2e/chat.spec.ts`

---

## 11. `overflow-y-auto` コンテナの可視性（1件）

**症状**: `locator('[class*="overflow-y-auto"]')` が要素を見つけるが、visible 判定に失敗。

**原因**: 空のスクロールコンテナは高さ0で描画されるため、Playwright が visible と判定しない。

**対応**: セレクタを `[class*="bg-nord-0"]`（背景色を持つ実際のコンテナ）に変更。

**ファイル**: `front/tests/e2e/responsive.spec.ts`

---

## CI スキップ対象テスト一覧

以下のテストは CI 環境でスキップされる（ローカルでは全て実行可能）:

| テストファイル | テスト名 | スキップ理由 |
|---------------|---------|-------------|
| `chat-streaming.spec.ts` | AI応答の内容が空でない | CPU only でストリーミング完了が遅い |
| `chat-streaming.spec.ts` | ストリーミング完了後、完全なメッセージが表示される | 同上 |
| `chat-streaming.spec.ts` | 短い応答が正しく表示される | 同上 |
| `chat-streaming.spec.ts` | 特殊文字を含む応答が正しく表示される | 同上 |
| `screenshot.spec.ts` | 全テスト | OS間レンダリング差異 |
| `debug-console.spec.ts` | 全テスト | デバッグ専用 |
| `debug-input.spec.ts` | 全テスト | デバッグ専用 |

## 今後の改善案

- **GPU 付き CI ランナー**: Self-hosted runner に GPU を搭載すればストリーミング完了テストも CI で実行可能
- **Mock LLM**: Ollama のレスポンスをモックすることで、LLM の推論速度に依存しないテストが可能
- **スクリーンショットの Linux ベースライン生成**: CI 上で `--update-snapshots` を実行し Linux 用ベースラインを作成すれば、CI でもスクリーンショットテストを実行可能
