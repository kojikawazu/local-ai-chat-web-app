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
 * ツール実行の記録。DB の `metadata.toolCalls` に保存され、後から実行履歴を再現するのに使う。
 */
export interface ToolCallRecord {
  /** 実行したツール名 */
  name: string;
  /** 実行時に渡した引数 */
  arguments: Record<string, unknown>;
  /** ツールが返した結果文字列 */
  result: string;
  /** 実行がエラーで終わったか */
  isError: boolean;
  /** 実行に要した時間（ミリ秒） */
  durationMs: number;
}

/**
 * エージェント実行中にサーバーからクライアントへ送るストリーミングイベント（NDJSON 1 行 = 1 イベント）。
 *
 * 各バリアントの意味:
 * - `text_delta`: LLM 応答テキストの増分。逐次的に画面へ追記する。
 * - `tool_call_start`: ツール実行の開始通知。どのツールをどの引数で呼ぶかを含む。
 * - `tool_call_result`: ツール実行の完了通知。結果文字列とエラー有無を含む。
 * - `done`: エージェントループ完了。ツール呼び出し履歴・ラウンド数・総所要時間を含みうる。
 * - `error`: 処理中に発生したエラー内容。
 * - `thinking`: LLM の思考過程テキスト（Phase C で追加）。
 */
export type AgentStreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call_start'; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_call_result'; name: string; result: string; isError: boolean }
  | { type: 'done'; metadata?: { toolCalls: ToolCallRecord[]; agentRounds?: number; agentDurationMs?: number } }
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
 * 実行可能なツールの実装。定義とその処理本体をひとまとめにする。
 */
export interface Tool {
  /** ツールのメタ情報（名前・説明・引数スキーマ） */
  definition: ToolDefinition;
  /**
   * ツール本体を実行する。
   *
   * @param args - LLM から渡された引数（キー→値のマップ）
   * @returns 実行結果を表す文字列（エラー時もエラー内容を文字列で返す）
   */
  execute: (args: Record<string, unknown>) => Promise<string>;
}
