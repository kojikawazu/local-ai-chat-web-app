import type { ToolCallInfo } from '@/types/agent/tool-call';

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
};

/**
 * エージェント実行中にサーバーからクライアントへ送るストリーミングイベント（NDJSON 1 行 = 1 イベント）。
 *
 * 各バリアントの意味:
 * - `text_delta`: LLM 応答テキストの増分。逐次的に画面へ追記する。
 * - `tool_call_start`: ツール実行の開始通知。どのツールをどの引数で呼ぶかと、その時点の本文の文字数（`contentOffset`。#186）を含む。
 * - `tool_call_result`: ツール実行の完了通知。結果文字列・エラー有無・要約を含む。
 * - `done`: エージェントループ完了。ツール呼び出し履歴・ラウンド数・総所要時間を含みうる。
 * - `error`: 処理中に発生したエラー内容。
 * - `thinking`: LLM の思考過程テキスト（Phase C で追加）。
 */
export type AgentStreamEvent =
  | { type: 'text_delta'; content: string }
  | {
      type: 'tool_call_start';
      name: string;
      arguments: Record<string, unknown>;
      contentOffset: number;
    }
  | ({ type: 'tool_call_result'; name: string } & ToolOutput)
  | {
      type: 'done';
      metadata?: {
        toolCalls: ToolCallInfo[];
        agentRounds?: number;
        agentDurationMs?: number;
      };
    }
  | { type: 'error'; message: string }
  | { type: 'thinking'; content: string }; // Phase C

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
 * - `local`: ローカル PC のファイルを読む
 * - `network`: 外部と通信する（引数に書いた内容が外へ出る）
 *
 * ループは、同じ応答の中で `local` のツールが成功した後は `network` のツールを実行しない
 * （読んだ内容を外へ送らせないため。`docs/14-local-file-tools.md`「外部への持ち出しを止める」）。
 */
export type ToolAccess = 'local' | 'network';

/**
 * 実行可能なツールの実装。定義とその処理本体をひとまとめにする。
 */
export type Tool = {
  /** ツールのメタ情報（名前・説明・引数スキーマ） */
  definition: ToolDefinition;
  /** 何に触れるか（{@link ToolAccess}）。どちらでもない（計算・日時）なら省略 */
  access?: ToolAccess;
  /**
   * ツール本体を実行する。
   *
   * 外部 I/O を行うツールは `signal` を fetch・本文読み取り・リトライ待機へ伝播し、
   * 中断されたら速やかに処理を止めること。ローカルで即時に終わるツールは無視してよい。
   *
   * @param args - LLM から渡された引数（キー→値のマップ）
   * @param signal - エージェントのツールタイムアウトで中断される signal
   * @returns 実行結果。失敗も例外にせず `isError: true` で返す（`output.ts` の `toolError`。
   *   接続先ごと使えない失敗は `toolUnavailable`）
   */
  execute: (
    args: Record<string, unknown>,
    signal: AbortSignal
  ) => Promise<ToolExecution>;
};
