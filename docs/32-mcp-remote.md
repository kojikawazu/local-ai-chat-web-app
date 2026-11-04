# リモートの MCP サーバーへの接続 設計書

> 最終更新: 2026-11-05
>
> **状態: 保留（2026-11-05）。** 設計のレビューの途中で止めた。使う相手が決まらなかったため（Atlassian は API トークンの有効化が不明、Google の公式サーバーは Developer Preview への参加が前提で、参加しない）。[決めること](#決めることレビューの論点)の R1〜R8 は未決定。

リモートの MCP サーバー（Streamable HTTP）につなぎ、OAuth 2.1 で認証するサーバーも使えるようにする設計（#208 Phase C・#249）。手元のサーバー（stdio）の設計は [31-mcp-client.md](./31-mcp-client.md) で、この文書はそこからの差分を扱う。

## 目次

- [背景](#背景)
- [調査で分かったこと](#調査で分かったこと)
- [範囲](#範囲)
- [決めること（レビューの論点）](#決めることレビューの論点)
- [設定](#設定)
- [接続](#接続)
- [OAuth の流れ](#oauth-の流れ)
- [API](#api)
- [画面](#画面)
- [セキュリティ](#セキュリティ)
- [ファイル構成](#ファイル構成)
- [テスト](#テスト)
- [未確認のこと](#未確認のこと)
- [やらないこと](#やらないこと)

## 背景

- 今は `command` で起動する手元のサーバーだけにつなげる。Atlassian の公式サーバーのようなリモートのサーバーは、`mcp-remote` 等の中継を挟まないと使えない
- `docs/31-mcp-client.md` で後に回した次の 2 つを、ここで決める
  - OAuth のトークンの保存・更新・取り消し（M3）
  - リモートのサーバーの `readOnlyHint` を信じるか（M5）

## 調査で分かったこと

2026-11-05 に確かめた。Atlassian には認証なしの公開の情報だけを読み、クライアントの登録はしていない。SDK は `@modelcontextprotocol/sdk` 1.32.2 のソースを読んだ。

### Atlassian の公式サーバー（実際に問い合わせた）

| 確かめたこと | 結果 |
|---|---|
| 接続先 | `https://mcp.atlassian.com/v2/mcp`。`/v1/mcp/authv2`・`/v1/mcp` も 401 を返す |
| 認証なしの応答 | 401 と `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/v2/mcp"`。`scope` は付かない |
| `?tools=all` を付けた応答 | 同じ 401 と同じ `resource_metadata` |
| 認可サーバー | `https://auth.atlassian.com/<ID>`（`/v2/mcp` の Protected Resource Metadata の `authorization_servers`） |
| クライアントの登録 | `client_id_metadata_document_supported: true` で、`registration_endpoint` もある |
| PKCE | `S256` だけ |
| 公開クライアント | `token_endpoint_auth_methods_supported` に `none` がある |
| `iss` の応答 | `authorization_response_iss_parameter_supported` は無い |
| スコープ | `scopes_supported` は 40 個で、`delete:jira:agent-interface`・`manage:jira:agent-interface` も含む |

### Atlassian の文書で読んだこと（実際には試していない）

- **既定のツール**: `/v2/mcp` は少数のツールと `discover`・`executeRead`・`executeWrite`・`executeDestructive` を出し、ほかはその裏に置く。`?tools=all` は平らな一覧を返す
- **API トークン**: 組織の管理者が有効にすると使える。個人のトークンは `Authorization: Basic <base64(メール:トークン)>` で送る
- **認証ごとのツールの違い**: Compass 等は OAuth だけ、Jira Service Management 等は API トークンだけ
- **v1**: 2027-03-01 に v2 のツールへ移る。v2 は別のリソースなので、認証し直しになる
- **課金**: 呼び出しごとに Rovo のクレジットを使う

### Google Workspace の公式サーバー（実際に問い合わせた）

製品ごとに別のサーバーで、Developer Preview の提供。Gmail・Drive・Calendar に認証なしで問い合わせた。

| 確かめたこと | 結果 |
|---|---|
| 接続先 | `https://gmailmcp.googleapis.com/mcp/v1` の形。Drive は `drivemcp`、Calendar は `calendarmcp` |
| 認証なしの `initialize`・`tools/list` | **どちらも 200 で通る。** 401 になるのはツールの呼び出しのはず（試していない）。Atlassian と違い、`WWW-Authenticate` から認証を始められない |
| Protected Resource Metadata | `/.well-known/oauth-protected-resource/mcp/v1` で取れる。認可サーバーは `https://accounts.google.com/` |
| クライアントの登録 | **`registration_endpoint` も CIMD も無い。** 事前の登録だけ |
| `iss` の応答 | `authorization_response_iss_parameter_supported: true`。応答に無ければ拒否する（仕様の表）。issuer は `https://accounts.google.com` で、メタデータの URL と末尾の `/` が違う |
| ツールの数 | Gmail 23・Drive 8・Calendar 9。合計 40 で、上限（M8）ちょうど。`discover` のような仕組みは無く、平らな一覧 |
| `readOnlyHint` | 読むツールに付いている（Gmail 6・Drive 5・Calendar 5）。書くツールには付かない |
| 送信のツール | Gmail にメールの送信は無く、下書き（`create_draft`）まで |
| 説明の長さ | 最大 2,589 文字。1,024 文字の上限で切られる |

Google の文書で読んだこと（実際には試していない）:

- 前提は Google Workspace Developer Preview Program への参加と、Google Cloud のプロジェクト。各 API と各 MCP のサービスを有効にする
- OAuth のクライアントは「ウェブ アプリケーション」で、**クライアントのシークレットが必要**。文書の例の戻り先は Antigravity と Claude だけで、手元のアプリの戻り先については書かれていない
- 個人の Gmail のアカウントで使えるかは書かれていない

### MCP の仕様（draft）

- 登録の優先順は、事前の登録 → Client ID Metadata Document（CIMD）→ 動的登録（DCR）。**DCR は非推奨**で、後方互換のために残っている
- CIMD は、クライアントが HTTPS の URL でメタデータを公開する必要がある
- DCR では `application_type` を指定する。`localhost` で動くアプリは `native`
- `resource` を認可とトークンの両方の要求に入れる
- `iss` が応答にあれば、記録した issuer と比べてからコードを送る
- スコープは最小にする

### SDK の挙動（ソースを読んだ）

| 確かめたこと | 結果 | 設計への影響 |
|---|---|---|
| トランスポート | `StreamableHTTPClientTransport` に `requestInit`（ヘッダー）・`authProvider`・`fetch` を渡せる | 固定のヘッダーも OAuth も同じ接続の処理に載る |
| 転送 | 既定の `redirectPolicy: 'same-origin'` は別のオリジンへの転送を追わない | そのままにする |
| トークンの更新 | 401 のときに `authProvider` で更新する。更新できなければ `redirectToAuthorization` を呼び `UnauthorizedError` を投げる | 接続の中で認可へ飛ばさない作りが要る |
| **スコープの選択** | `scope 引数 \|\| scopes_supported の全部 \|\| clientMetadata.scope` の順 | **`clientMetadata.scope` に書いても使われない。** Atlassian なら削除の権限まで求める。`auth()` の `scope` 引数で渡す |
| `iss` の検証 | コールバックはアプリが受けるため、SDK は見ない | アプリで比べる |
| 登録情報と issuer | 保存した登録情報を issuer に結びつけて検査する | 保存する形に `issuer` を残す |
| `application_type` | SDK は足さない | `clientMetadata` に書く |
| トークンの取り消し | `auth()` の流れには無い | 取り消しはアプリで書く |
| `?tools=all` の `resource` | 比べるのはパスの前方一致で、クエリは見ない | 通るはず（[未確認のこと](#未確認のこと)） |

## 範囲

| 含める | 含めない（[やらないこと](#やらないこと)） |
|---|---|
| Streamable HTTP での接続 | 古い SSE のトランスポート |
| 固定のヘッダーの認証（API トークン等） | CIMD でのクライアントの登録 |
| OAuth（認可コード + PKCE・事前の登録・DCR） | 画面からのサーバーの追加 |
| 認証の開始・取り消しの画面 | スコープの段階的な追加（step-up） |
| リモートのサーバーの承認の決まり | プライベートのアドレスのサーバー（社内のサーバー等） |

## 決めること（レビューの論点）

| # | 論点 | 推奨 | ほかの案 | 理由 |
|---|---|---|---|---|
| R1 | 分け方 | **2 つの PR に分ける。** C1: HTTP と固定のヘッダー、C2: OAuth | 1 つの PR | C1 は小さく、管理者が API トークンを有効にしていれば Atlassian にもつながる。OAuth はトークンの保存と新しい API が要り大きい |
| R2 | `readOnlyHint` | **リモートでは信じない。** 承認なしにできるのは、設定の `readOnlyTools` に書いたツールだけ | 手元のサーバーと同じに信じる | M5 で信じた理由は「利用者が選んで動かすプログラム」だった。リモートは版を固定できず、接続の後でも中身が変わる。嘘の申告は、承認なしの書き込みになる |
| R3 | トークンの置き場所 | **リポジトリの外のファイル**（`MCP_CONFIG_PATH` と同じフォルダの `mcp-auth/<サーバー>.json`。フォルダ `0700`・ファイル `0600`） | macOS のキーチェーン / DB | `.env.local` と同じ守り方で、`mcp-remote` も同じ形。キーチェーンはより安全だが macOS に閉じ、テストもしにくい。DB は Prisma Studio やダンプで見える |
| R4 | クライアントの登録 | **事前の登録（`auth.clientId`・`auth.clientSecret`）を使い、書いていなければ DCR** | DCR だけ / CIMD | Google は事前の登録しかできない。Atlassian は DCR が使える。CIMD は HTTPS で公開する URL が要り、手元のアプリには無い（SDK は `clientMetadataUrl` で対応済みなので、要れば足す） |
| R5 | スコープ | **設定の `auth.scopes` を必須にし、`auth()` の引数で渡す** | サーバーの既定に任せる | 任せると Atlassian では削除・管理の権限まで求める。読むだけのスコープで始められる |
| R6 | 認証を始める場所 | **設定の画面のボタンだけ。** チャットの途中では始めない | 応答の中で承認カードを出す | モデルに認証を始めさせない。接続の処理（`/api/chat`）がブラウザを開くことも無い |
| R7 | Atlassian のツールの出し方 | **`?tools=all` と `tools` の絞り込みをマニュアルで案内する**（アプリに Atlassian の特別扱いは入れない） | 既定の `discover`・`execute*` を使う | `executeRead` は引数でどのツールでも呼べるので、ツールの名前で絞る・承認する仕組みが効かない。小さいモデルに 2 段の呼び出しをさせる負担もある |
| R8 | 宛先の制限 | **`https` だけ。`http` はループバックのときだけ。** 認可の処理の通信も含めてプライベートのアドレスを止める | 制限しない | サーバーが返すメタデータの URL は相手が決められる。止めないと、手元のサービスを読みに行かせられる（SSRF） |

## 設定

`url` と `command` はどちらか一方を書く。両方・どちらも無しは「設定の誤り」にする。

```json
{
  "mcpServers": {
    "atlassian": {
      "url": "https://mcp.atlassian.com/v2/mcp?tools=all",
      "auth": {
        "type": "oauth",
        "scopes": ["read:jira:agent-interface", "search:jira:agent-interface", "offline_access"]
      },
      "tools": ["getJiraIssue", "searchJiraIssuesUsingJql", "createJiraIssue"],
      "readOnlyTools": ["getJiraIssue", "searchJiraIssuesUsingJql"]
    },
    "atlassian-token": {
      "url": "https://mcp.atlassian.com/v2/mcp?tools=all",
      "headers": { "Authorization": "Basic ${ATLASSIAN_BASIC_AUTH}" },
      "tools": ["getJiraIssue"],
      "readOnlyTools": ["getJiraIssue"]
    }
  }
}
```

例のツールの名前は説明のためのもので、実際の名前はつないでから確かめる。

| 項目 | 使えるサーバー | 意味 |
|---|---|---|
| `url` | リモート | 接続先。`https`（ループバックは `http` も可）。ユーザー名・パスワードの入った URL は誤りにする。`${NAME}` は置き換えない（秘密を URL に入れさせない） |
| `headers` | リモート | 足すヘッダー。値の `${NAME}` は `env` と同じく置き換える |
| `auth` | リモート | `{ "type": "oauth", "scopes": [...] }`。`scopes` は 1 つ以上。`headers` の `Authorization` とは同時に書けない。`clientId`・`clientSecret`（値の `${NAME}` を置き換える）で事前に登録したクライアントを使う。`authorizationParams` は認可の URL に足す値 |
| `readOnlyTools` | リモート | 承認なしで実行するツールの名前（R2）。`alwaysApprove` に同じ名前があれば、そちらを優先する |
| `tools`・`alwaysApprove` | 両方 | 手元のサーバーと同じ |
| `command`・`args`・`env`・`cwd` | 手元 | 手元のサーバーと同じ |

片方にしか使えない項目をもう片方に書いたら「設定の誤り」にする（黙って無視しない）。

更新のトークンをもらう方法はサーバーで違う。Atlassian は `scopes` に `offline_access` を書き、Google は `authorizationParams` に `{ "access_type": "offline", "prompt": "consent" }` を書く。無ければ、アクセストークンが切れるたびに認証し直しになる。

Google の Calendar の例:

```json
{
  "mcpServers": {
    "calendar": {
      "url": "https://calendarmcp.googleapis.com/mcp/v1",
      "auth": {
        "type": "oauth",
        "scopes": ["https://www.googleapis.com/auth/calendar.events.readonly"],
        "clientId": "${GOOGLE_MCP_CLIENT_ID}",
        "clientSecret": "${GOOGLE_MCP_CLIENT_SECRET}",
        "authorizationParams": { "access_type": "offline", "prompt": "consent" }
      },
      "readOnlyTools": ["list_events", "get_event", "search_events"]
    }
  }
}
```

## 接続

`connections.ts` の `connect()` で、トランスポートを設定の形で選ぶ。接続の管理（`globalThis`・再接続・`onclose`）は今のまま使う。

| 違い | 手元 | リモート |
|---|---|---|
| トランスポート | `StdioClientTransport` | `StreamableHTTPClientTransport` |
| 失敗の理由 | 標準エラーの末尾を足す | 標準エラーは無い。ヘッダーの値を理由に入れない |
| 読むツールの判定 | `readOnlyHint: true` | `readOnlyTools` にある |
| 認証が要る | 無い | `authProvider`（`auth` があるとき） |

状態に `auth_required` を足す。

| 状況 | 状態 | 動き |
|---|---|---|
| `auth` があり、保存したトークンが無い | `auth_required` | **通信せずに**飛ばす。応答は止めない |
| 接続・呼び出しの途中で `UnauthorizedError` | `auth_required` | 接続を閉じ、トークンを無効にする。ツールの結果は `toolUnavailable` |
| `auth` が無く 401 | `failed` | 理由を出す（ヘッダーの誤り等）。Google のように接続は通り、呼び出しで初めて 401 になるサーバーもある |
| セッションが切れた（404） | 接続なし | 次の応答で接続し直す |

接続の処理に渡す `authProvider` では、`redirectToAuthorization` と `saveCodeVerifier` は何もしない（`UnauthorizedError` だけが伝わる）。SDK は更新に失敗すると認可の準備まで進むため、進行中の認証の `code_verifier` を上書きさせないためでもある。認可の URL を受け取るのは、[OAuth の流れ](#oauth-の流れ)の開始の処理だけにする。

持ち出しの抑止（`origin`・`shouldBlockTool`）は変えない。リモートのツールも `mcp:<サーバー>` の出どころを持ち、「読む」と「外部と通信する」の両方の性質で扱う。

## OAuth の流れ

```
設定の画面「認証する」
 → POST /api/mcp/servers/[name]/authorize
     auth(provider, { serverUrl, scope })  … 発見・DCR・PKCE
     state・code_verifier・issuer を保留の表（globalThis）に入れる
 ← { authorizationUrl }
 → 新しいタブで開く → 利用者が認可の画面で許可する
 → GET /api/mcp/oauth/callback?code&state[&iss]
     state を保留の表から取り出す（1 回限り・10 分まで）
     iss を記録した issuer と比べる（無ければメタデータの宣言で判断する）
     auth(provider, { serverUrl, authorizationCode })  … トークンの取得
     トークンをファイルに保存し、接続を閉じて読み直す状態にする
 ← 「認証しました。このタブを閉じてください」
元のタブがフォーカスを取り戻すと /api/tools を読み直す
```

- `redirect_uri` は `<アプリのオリジン>/api/mcp/oauth/callback`。オリジンは要求から取り、ホストがループバックのときだけ認める（`Host` を細工されても別の宛先へ返さない）
- DCR のとき、保存した登録の `redirect_uris` と今のオリジンが違えば（ポートを変えた等）、登録し直す。事前の登録では、認可サーバーの設定に戻り先を書いてもらう
- 認証の開始は `WWW-Authenticate` に頼らず、`auth()` に `serverUrl` を渡して発見する（Google は接続で 401 にならない）
- 比べる issuer はメタデータの `issuer` の値を使う（Protected Resource Metadata の URL は末尾の `/` が違うことがある）
- `clientMetadata` の `token_endpoint_auth_method` は、シークレットがあれば `client_secret_post` にする
- DCR の `clientMetadata` は `application_type: 'native'`・`token_endpoint_auth_method: 'none'`・`grant_types: ['authorization_code', 'refresh_token']`
- トークンの更新は SDK に任せ、`saveTokens` で書き直す。書き込みは一時ファイルからの `rename` にする
- コールバックの応答には、受け取った値（`error_description` 等）を入れない。理由はサーバーのログと設定の画面の状態に出す
- 取り消し（「認証を解除」）: 認可サーバーの `revocation_endpoint` へ送ってみてから（失敗しても続ける）、ファイルを消し、接続を閉じる

## API

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/mcp/servers/[name]/authorize` | 認証を始める。`{ authorizationUrl }` を返す。知らないサーバーは 404、`auth` の無いサーバーは 409、認可の処理の失敗は 502 |
| DELETE | `/api/mcp/servers/[name]/authorization` | 認証を解除する |
| GET | `/api/mcp/oauth/callback` | 認可サーバーからの戻り先。結果は短い HTML で返す |

`/api/tools` の `mcp.servers` の `state` に `auth_required` が増え、`auth` があるサーバーには `hasAuth: true` を足す。C1 では API を足さない。

## 画面

`McpServerList` に足す。

- 状態の表示に「認証が必要」を足す
- `auth` があるサーバーに「認証する」「認証を解除」のボタンを出す
- 認可の URL は `https:` のときだけ開く。`noopener` で開く

## セキュリティ

| 脅威 | 対策 |
|---|---|
| トークンがリポジトリ・ログに入る | リポジトリの外のファイルに `0600` で置く。ログ・画面・ツールの結果に出さない |
| モデルがトークンを読む | モデルへ渡さない。`mcp-auth` を `path-guard.ts` の「中身を読ませないフォルダ」に足し、`LOCAL_FILE_ROOTS` の中にあっても読ませない。`run_command` で読むことは承認が守りになる |
| 悪いページが認証を始める・解除する | 2 つの API は `Content-Type: application/json` と同じオリジンの `Origin` を求める（アプリに認証が無いため。`Origin` の検査はこのアプリで初めて入れる） |
| コールバックの偽造（CSRF） | `state` はランダムな値で、1 回限り・10 分まで。保留の表に無ければ何もしない |
| 別の認可サーバーのコードを混ぜられる | `iss` を記録した issuer と比べる。サーバーが `iss` を出すと宣言していて応答に無ければ拒否する（仕様の MUST） |
| クライアントのシークレットの漏れ | 設定には `${NAME}` で書き、値は `.env.local` に置く。ログ・画面に出さない |
| 認可の URL に危ないスキームを書かれる | SDK の検証に加え、API と画面で `https:` だけを通す |
| メタデータの URL で手元のサービスを読ませる（SSRF） | `StreamableHTTPClientTransport` の `fetch` に、`checkSsrf`（`tools/network-guard.ts`）で宛先を調べる関数を渡す。サーバーの `url` がループバックのときだけ、ループバックを許す |
| 名前の解決の結果が判定と接続の間に変わる | 防げない（`url_fetch` と同じ）。設定に書いたサーバーだけが相手なので受け入れる |
| 読むと申告して書き込む | R2。`readOnlyTools` に書いたものだけ承認を省く |
| 必要以上の権限を求める | R5 |
| リモートのサーバーが読んだ内容を外へ送る | 引数はサーバーへ届く。持ち出しの抑止で、ほかの出どころを読んだ後の承認なしの呼び出しを止める |

## ファイル構成

```
front/src/lib/agent/tools/mcp/
├── config.ts             # url・headers・auth・readOnlyTools の検証を足す（C1・C2）
├── connections.ts        # トランスポートの選択・auth_required（C1・C2）
├── transport.ts          # リモートのトランスポートと宛先の検査（C1）
├── tool.ts               # 読むツールの判定を手元とリモートで分ける（C1）
├── oauth-provider.ts     # OAuthClientProvider の実装（C2）
├── oauth-store.ts        # トークンのファイルの読み書き（C2）
└── oauth-flow.ts         # 開始・戻り・解除と保留の表（globalThis）（C2）
front/src/app/api/mcp/
├── servers/[name]/authorize/route.ts      # C2
├── servers/[name]/authorization/route.ts  # C2
└── oauth/callback/route.ts                # C2
```

## テスト

- **UT**: 設定の検証（`url` と `command`・片方だけの項目・`http` とループバック・`auth.scopes`）、読むツールの判定、`iss` の比較、`state` の期限と 1 回限り
- **IT**: 手元で起こした本物の HTTP の MCP サーバーと認可サーバー（テスト用のヘルパー）に、実際の SDK でつなぐ。固定のヘッダー、401 → `auth_required`、認可コードの交換、トークンの更新、`state` の不一致、`iss` の不一致、取り消し、宛先の検査
- **E2E**: 同じサーバーをつなぎ、「認証する」→ 認可 → 状態が接続中になるところを見る。ツールの呼び出しに依存するテストは `IS_LIGHT_MODEL` でスキップする
- 外部サービスには触れない。Atlassian での確認は手動で行い、結果をこの文書に残す

## 未確認のこと

実装の前か途中で確かめる。

- **DCR に `http://localhost:3000/...` を登録できるか**: Atlassian へ書き込みになるため試していない。C2 の始めに、利用者の確認の後に試す
- **`?tools=all` で OAuth が通るか**: `resource` はパスの比較で通るはずだが、実際のトークンでは試していない
- **実物のツール**: 数・説明の長さ・`readOnlyHint` の有無。40 個の上限（M8）で足りるか、`qwen3.8:27b` が選べるか
- **API トークンを使えるか**: 組織の管理者の有効化が要る。文書には権限のスコープの指定が要るともある
- **Google の Developer Preview に入れるか・個人の Gmail で使えるか**: 文書に書かれていない
- **Google の OAuth クライアントに `http://localhost:3000/...` を戻り先にできるか**: 文書の例に無い
- **Google が `resource` の値を受け付けるか**: MCP の仕様では必ず送るが、試していない
- **Google の 1,024 文字で切った説明で、モデルが選べるか**: Gmail の説明は最大 2,589 文字
- **アクセストークンの有効期間と更新のトークンの扱い**: 文書に書かれていない

## やらないこと

- 古い SSE のトランスポート（Atlassian の `/v1/sse` は 2026-06-30 で終わっている）
- CIMD（要るときに足す）
- スコープの段階的な追加（403 の `insufficient_scope` は失敗として出し、設定の `scopes` を直してもらう）
- プライベートのアドレスのサーバー（要るなら設定で明示する形を別に決める）
- トークンの暗号化・キーチェーン（R3）
- Atlassian の特別扱い（R7）
- サブエージェントへ MCP のツールを渡す（`docs/31-mcp-client.md` のまま）
