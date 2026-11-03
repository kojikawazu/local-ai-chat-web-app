import type { ToolCallInfo } from '@/types/agent/tool-call';
import type { ResponseMetrics } from './metrics';
import type { KnowledgeSource } from '@/types/knowledge/document';

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
    /** 応答のトークン数・所要時間（#31）。停止した応答・この機能より前の応答は持たない */
    metrics?: ResponseMetrics;
    /**
     * 送ったときに探したドキュメントの出典（#17 Phase B）。空の配列は「探したが見つからなかった」。
     * ドキュメントを参照しなかった応答は持たない
     */
    knowledgeSources?: KnowledgeSource[];
    /** 応答の途中で利用者が送った指示（#241）。送っていない応答は持たない */
    instructions?: ResponseInstruction[];
  } | null;
  /**
   * 保存に失敗したときだけ付く状態（{@link MessageSaveState}）。省略時は保存済み。
   * user メッセージで付いている場合は LLM にも送られていない。
   */
  saveState?: MessageSaveState;
  /** 添付した画像（並び順。#6）。user のメッセージだけが持ち、無ければ省略 */
  images?: MessageImage[];
  /** 付いているブックマークの ID（#30）。保存済みの応答だけが持ち、付いていなければ省略 */
  bookmarkId?: string;
};

/** LLM へ渡す会話履歴の 1 件（`/api/chat` の `conversationHistory` の要素）。 */
export type HistoryEntry = Pick<Message, 'role' | 'content'> & {
  /** そのメッセージの添付画像の ID（#6）。サーバーが DB から読んで LLM へ渡す。無ければ省略 */
  imageIds?: string[];
};

/**
 * 応答の途中で利用者が送った指示（割り込み。#241。`docs/30-agent-interrupt.md`）。
 *
 * 保存するのは `content`・`contentOffset`・`toolCallIndex`・`unread`。`id`・`pending` は生成中の画面だけが持つ。
 */
export type ResponseInstruction = {
  /** 指示の本文 */
  content: string;
  /** エージェントが読んだ時点の本文の文字数（時系列の位置）。読まれていなければ持たない */
  contentOffset?: number;
  /** エージェントが読んだ時点までに呼んだツールの数（同じ位置のツールとの前後を決める）。読まれていなければ持たない */
  toolCallIndex?: number;
  /** 読まれずに応答が終わった（停止・ラウンドの上限）なら true */
  unread?: boolean;
  /** 指示の ID（指示の API が返し、`instruction_applied` で当てる）。画面だけが持つ */
  id?: string;
  /** 送ったが、まだ読まれていないなら true。画面だけが持つ */
  pending?: boolean;
};
