import type { ToolCallInfo } from '@/types/agent/tool-call';

/**
 * 永続化に失敗したメッセージのクライアント側の状態。API・DB には存在しない。
 *
 * `failed` は保存に失敗して再試行待ち、`retrying` は再試行中を表す。
 * 保存済みのメッセージはこの状態を持たない。
 */
export type MessageSaveState = 'failed' | 'retrying';

/**
 * メッセージに添付した画像の表示に要る情報（#6）。画像の中身は持たず、`src` から読む。
 */
export type MessageImage = {
  /** 添付の ID（UUID。ブラウザが採番し、DB の ID になる） */
  id: string;
  /**
   * 表示に使う URL。送ったばかりの画像は手元の data: URI、DB から読み直した画像は
   * `/api/attachments/[id]`
   */
  src: string;
  /** 幅（px。縮小後） */
  width: number;
  /** 高さ（px。縮小後） */
  height: number;
};

/**
 * チャット上の 1 メッセージ。ユーザー発話とアシスタント応答の両方を表す。
 */
export type Message = {
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
    /** ユーザーが生成を停止した応答なら true（本文は停止までの途中のもの） */
    interrupted?: boolean;
  } | null;
  /**
   * 保存に失敗したときだけ付く状態（{@link MessageSaveState}）。省略時は保存済み。
   * user メッセージで付いている場合は LLM にも送られていない。
   */
  saveState?: MessageSaveState;
  /** 添付した画像（並び順。#6）。user のメッセージだけが持ち、無ければ省略 */
  images?: MessageImage[];
};

/** LLM へ渡す会話履歴の 1 件（`/api/chat` の `conversationHistory` の要素）。 */
export type HistoryEntry = Pick<Message, 'role' | 'content'> & {
  /** そのメッセージの添付画像の ID（#6）。サーバーが DB から読んで LLM へ渡す。無ければ省略 */
  imageIds?: string[];
};
