/**
 * エージェントが実行した 1 回のツール呼び出しの記録。
 */
export interface ToolCallInfo {
  /** 呼び出されたツール名 */
  name: string;
  /** ツールに渡された引数（キー名は各ツール定義に依存） */
  arguments: Record<string, unknown>;
  /** ツール実行結果の文字列表現 */
  result: string;
  /** 実行がエラー終了したかどうか */
  isError: boolean;
  /** ツール実行にかかった時間（ミリ秒） */
  durationMs: number;
}

/**
 * チャット上の 1 メッセージ。ユーザー発話とアシスタント応答の両方を表す。
 */
export interface Message {
  /** メッセージの一意 ID（UUID） */
  id: string;
  /** 発話者の役割（ユーザー / アシスタント） */
  role: 'user' | 'assistant';
  /** メッセージ本文（Markdown を含みうる） */
  content: string;
  /** メッセージ作成日時 */
  createdAt: Date;
  /**
   * エージェント実行に関する付随情報。ツール未使用時は省略または `null`。
   */
  metadata?: {
    /** このメッセージ生成中に実行されたツール呼び出しの一覧 */
    toolCalls?: ToolCallInfo[];
    /** エージェントの思考過程テキスト */
    thinkingText?: string;
    /** エージェントループのラウンド数 */
    agentRounds?: number;
    /** エージェント処理全体にかかった時間（ミリ秒） */
    agentDurationMs?: number;
  } | null;
}

/**
 * 会話（メッセージのまとまり）のメタ情報。サイドバーの履歴表示に用いる。
 */
export interface Conversation {
  /** 会話の一意 ID（UUID） */
  id: string;
  /** 会話タイトル（LLM で自動生成されうる） */
  title: string;
  /** 作成日時（API から ISO 文字列で受け取る） */
  createdAt: string;
  /** 最終更新日時（API から ISO 文字列で受け取る） */
  updatedAt: string;
}
