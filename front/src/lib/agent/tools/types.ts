import type {
  ApprovalPreview,
  ToolCallInfo,
  ToolScreenshot,
} from '@/types/agent/tool-call';

/**
 * Ollama API の function calling へ渡すツール定義。
 *
 * Ollama の chat API が要求する JSON Schema 準拠の形式で、各ツールの
 * メタ情報（名前・説明・引数スキーマ）を表す。
 */
export interface OllamaToolDefinition {
  /** 常に `'function'`。Ollama のツール種別を示す固定値 */
  type: 'function';
  /** ツール本体の定義 */
  function: {
    /** ツール名（LLM が呼び出し時に指定する識別子） */
    name: string;
    /** ツールの用途説明。LLM が呼び出し可否を判断する材料になる */
    description: string;
    /** 引数の JSON Schema */
    parameters: {
      /** 常に `'object'`。引数はオブジェクト形式で受け取る */
      type: 'object';
      /** 引数プロパティ名 → スキーマ（型・説明・列挙値）のマップ */
      properties: Record<
        string,
        {
          /** 引数の型（`'string'` / `'number'` 等の JSON Schema 型名） */
          type: string;
          /** 引数の説明。LLM が値を組み立てる際の指針になる */
          description: string;
          /** 取りうる値を限定する場合の列挙リスト（任意） */
          enum?: string[];
        }
      >;
      /** 必須引数名のリスト */
      required: string[];
    };
  };
}

/**
 * Ollama のレスポンスに含まれるツール呼び出し要求。
 *
 * LLM が「このツールをこの引数で実行したい」と応答したときの構造。
 */
export interface OllamaToolCall {
  /** 呼び出し対象のツールと引数 */
  function: {
    /** 呼び出すツール名 */
    name: string;
    /** ツールへ渡す引数（キー→値のマップ） */
    arguments: Record<string, unknown>;
  };
}

/**
 * ツールの実行結果。モデルへ返す文章と、画面に出す成否・要約を分けて持つ（#150）。
 *
 * 失敗も例外ではなくこの形で返す。モデルは `result` の文章で失敗を理解し、
 * 画面は `isError` で ❌ を出す（文章の先頭が「エラー: 」かで判定すると、
 * 取得したページの本文がたまたまそう始まるだけで失敗と誤判定するため）。
 */
export type ToolOutput = Pick<
  ToolCallInfo,
  'result' | 'isError' | 'summary' | 'isEmpty'
>;

/**
 * ツールの実行結果に、エージェントループだけが読む印を足したもの（#157）。
 *
 * 印はループが取り除いてから画面・DB へ送る（{@link ToolOutput} だけが外に出る）。
 */
export type ToolExecution = ToolOutput & {
  /**
   * 入力に関係なく、ツールの接続先ごと使えない失敗なら true（例: SearXNG の停止・
   * すべての検索エンジンの無応答）。同じ応答の中では、このツールを再び実行しない。
   * 入力ごとに成否が変わる失敗（取得できない URL 等）には付けない
   */
  unavailable?: boolean;
  /**
   * モデルへ画像として渡すもの（`data:` の接頭辞なしの Base64。#149）。ループが `role: 'tool'` のメッセージの
   * `images` に入れる。画面・DB へは送らない
   */
  images?: string[];
  /**
   * 手元の情報を読んだなら true（#149）。`access` だけでは決まらないとき（公開の URL を開いたら手元の
   * 開発サーバーへ転送された等）に、実行の後でループへ知らせる。以降は外部と通信するツールを止める
   */
  readLocal?: boolean;
  /**
   * 利用者へ見せる画面のスクリーンショット（中身付き。#200）。ループが `tool_call_result` のイベントに載せ、
   * 記録（`done`・DB）には中身を外して入れる。モデルへは渡さない（モデルへ渡す画像は `images`）
   */
  screenshots?: ToolScreenshot[];
};

/**
 * エージェントループが 1 回の応答ごとに作り、ツールへ渡す文脈（#149。`docs/18-browser-tools.md`）。
 *
 * 応答をまたがない状態（ブラウザのページ）を、同じ応答のツールの呼び出しの間で共有し、応答の終わりに片付ける。
 */
export type ToolContext = {
  /** このアプリ自身のオリジン（`/api/chat` のリクエストのオリジン）。分からなければ `undefined` */
  appOrigin?: string;
  /** 応答ごとに 1 つ作るものを置く場所（キーはツールの側で決める） */
  scope: Map<string, unknown>;
  /**
   * 応答の終わり（完了・エラー・停止）に行う後始末を登録する
   *
   * @param dispose - 後始末。失敗してもほかの後始末は続ける
   */
  onDispose: (dispose: () => Promise<void>) => void;
  /**
   * この応答で手元の情報を読むツールが成功したか（以降は外部と通信しない）
   *
   * @returns 読んでいれば true
   */
  hasReadLocal: () => boolean;
};

/**
 * エージェント実行中にサーバーからクライアントへ送るストリーミングイベント（NDJSON 1 行 = 1 イベント）。
 *
 * 各バリアントの意味:
 * - `text_delta`: LLM 応答テキストの増分。逐次的に画面へ追記する。
 * - `tool_call_start`: ツール実行の開始通知。どのツールをどの引数で呼ぶかと、その時点の本文の文字数（`contentOffset`。#186）を含む。
 * - `tool_call_result`: ツール実行の完了通知。結果文字列・エラー有無・要約を含む。ブラウザのツールは撮った画面を中身付きで含む（#200）。
 * - `done`: エージェントループ完了。ツール呼び出し履歴・ラウンド数・総所要時間を含みうる。
 * - `error`: 処理中に発生したエラー内容。
 * - `thinking`: LLM の思考過程テキスト（Phase C で追加）。
 * - `tool_approval_request`: 承認が要るツールの実行前に、承認 ID と見せる内容を送る（#148 Phase A2）。
 *   画面は承認の API で許可か拒否かを返す。決着は続く `tool_call_result`（`approval` 付き）で分かる。
 *   待ち時間の上限（`timeoutMs`）を載せ、画面は受け取った時刻から残り時間を数える（#202。時計のずれに左右されないよう、絶対時刻は送らない）。
 */
export type AgentStreamEvent =
  | { type: 'text_delta'; content: string }
  | {
      type: 'tool_call_start';
      name: string;
      arguments: Record<string, unknown>;
      contentOffset: number;
    }
  | ({ type: 'tool_call_result'; name: string } & ToolOutput &
      Pick<ToolCallInfo, 'approval' | 'screenshots'>)
  | {
      type: 'done';
      metadata?: {
        toolCalls: ToolCallInfo[];
        agentRounds?: number;
        agentDurationMs?: number;
      };
    }
  | { type: 'error'; message: string }
  | { type: 'thinking'; content: string } // Phase C
  | {
      type: 'tool_approval_request';
      approvalId: string;
      name: string;
      preview: ApprovalPreview;
      timeoutMs: number;
    };

/**
 * ツールのメタ情報（名前・説明・引数スキーマ）を表す内部向け定義。
 *
 * `OllamaToolDefinition` の `function` 部分に相当し、`getAllToolDefinitions` で
 * Ollama 向け形式へ変換される。
 */
export interface ToolDefinition {
  /** ツール名（レジストリのキー兼 LLM 呼び出し時の識別子） */
  name: string;
  /** ツールの用途説明。LLM が呼び出し可否を判断する材料になる */
  description: string;
  /** 引数の JSON Schema */
  parameters: {
    /** 常に `'object'`。引数はオブジェクト形式で受け取る */
    type: 'object';
    /** 引数プロパティ名 → スキーマ（型・説明・列挙値）のマップ */
    properties: Record<
      string,
      {
        /** 引数の型（`'string'` / `'number'` 等の JSON Schema 型名） */
        type: string;
        /** 引数の説明。LLM が値を組み立てる際の指針になる */
        description: string;
        /** 取りうる値を限定する場合の列挙リスト（任意） */
        enum?: string[];
      }
    >;
    /** 必須引数名のリスト */
    required: string[];
  };
}

/**
 * ツールが何に触れるか（#148）。エージェントループだけが読み、モデルには渡さない。
 *
 * - `local`: 利用者の手元の情報を読む（ローカル PC のファイル・コマンドの出力、非公開のこともある GitHub のリポジトリの内容。#148 Phase C）
 * - `network`: 外部と通信する（引数に書いた内容が外へ出る）
 *
 * ループは、同じ応答の中で `local` のツールが成功した後は `network` のツールを実行しない
 * （読んだ内容を外へ送らせないため。`docs/14-local-file-tools.md`「外部への持ち出しを止める」）。
 */
export type ToolAccess = 'local' | 'network';

/**
 * 承認が要るツールの、承認の前に済ませた準備の結果（#148 Phase A2）。
 *
 * 準備で引数・パス・上限を確かめ、見せる内容（差分）と、許可されたら行う処理を作る。
 * 準備で失敗したら承認は求めず、その結果をそのままモデルへ返す。
 */
export type PreparedAction =
  | {
      ok: true;
      /** 利用者へ見せる内容 */
      preview: ApprovalPreview;
      /**
       * 準備で撮った画面（中身付き。#200）。承認の結果（許可・拒否・時間切れ）にかかわらず、ループが結果に入れる
       */
      screenshots?: ToolScreenshot[];
      /**
       * 許可されたら行う処理。準備で作った内容をそのまま実行する（見せた内容と違うことはしない）
       *
       * @param signal - ツールのタイムアウト・停止で中断される signal
       * @returns 実行結果
       */
      run: (signal: AbortSignal) => Promise<ToolExecution>;
    }
  | {
      ok: false;
      /** 準備で失敗した結果 */
      output: ToolExecution;
    };

/**
 * 実行可能なツールの実装。定義とその処理本体をひとまとめにする。
 */
export type Tool = {
  /** ツールのメタ情報（名前・説明・引数スキーマ） */
  definition: ToolDefinition;
  /**
   * 何に触れるか（{@link ToolAccess}）。どちらでもない（計算・日時）なら省略。
   * 引数で変わるツール（開く URL で変わるブラウザ。#149）は、引数から決める関数にする
   */
  access?:
    ToolAccess | ((args: Record<string, unknown>) => ToolAccess | undefined);
  /**
   * 結果をモデルへ画像で渡すツールなら true（#149）。画像を読めないモデルには渡さない
   * （画像の無い結果に対して、モデルは見たふりをして答えるため）
   */
  requiresVision?: boolean;
  /**
   * 承認の後の実行（`prepare` が返す `run`）に掛ける時間の上限（ミリ秒。#148 Phase B）。
   * 省略時はツール全般の上限（`AGENT_TOOL_TIMEOUT_MS`）。コマンドの実行のように 30 秒で終わらないツールが、
   * 自分で止める時間より少し長くして、止まらなかったときの保険にする
   */
  runTimeoutMs?: number;
  /**
   * 順に実行する組の名前（#149 Phase C）。同じ組のツールは、同じ応答の中で 1 つずつ、呼ばれた順に実行する
   * （前の呼び出しの準備・承認・実行が終わってから次に入る）。1 つのページを共有するブラウザのツールが、
   * 前の操作の後のページで次の準備（承認カードの要素）を作るため。省略したツールは並べて実行する
   */
  exclusive?: string;
  /**
   * 実行前に承認が要るツールの準備（#148 Phase A2）。持つツールは、エージェントループが準備 → 承認 → `run` の順に進め、
   * `execute` は呼ばない。承認の要らないツールは省略する
   *
   * @param args - LLM から渡された引数
   * @param signal - ツールのタイムアウト・停止で中断される signal
   * @param context - 応答ごとの文脈（{@link ToolContext}。#149 Phase C）。エージェントループは必ず渡す。
   *   使わないツールは受け取らなくてよい。ループの外（テスト）から直接呼ぶときは省略でき、文脈が要るツールは失敗を返す
   * @returns 準備の結果（{@link PreparedAction}）
   */
  prepare?: (
    args: Record<string, unknown>,
    signal: AbortSignal,
    context?: ToolContext
  ) => Promise<PreparedAction>;
  /**
   * ツール本体を実行する。
   *
   * 外部 I/O を行うツールは `signal` を fetch・本文読み取り・リトライ待機へ伝播し、
   * 中断されたら速やかに処理を止めること。ローカルで即時に終わるツールは無視してよい。
   *
   * @param args - LLM から渡された引数（キー→値のマップ）
   * @param signal - エージェントのツールタイムアウトで中断される signal
   * @param context - 応答ごとの文脈（{@link ToolContext}）。エージェントループは必ず渡す。使わないツールは受け取らなくてよい。
   *   ループの外（テスト）から直接呼ぶときは省略でき、文脈が要るツールは失敗を返す
   * @returns 実行結果。失敗も例外にせず `isError: true` で返す（`output.ts` の `toolError`。
   *   接続先ごと使えない失敗は `toolUnavailable`）
   */
  execute: (
    args: Record<string, unknown>,
    signal: AbortSignal,
    context?: ToolContext
  ) => Promise<ToolExecution>;
};
