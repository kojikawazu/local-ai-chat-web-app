/**
 * 結果が届く前のツール呼び出しの状態（#192）。画面だけが持ち、サーバーは付けず、保存もしない。
 *
 * - `running`: 実行中（承認が要るツールは、許可・拒否を返した後）
 * - `awaiting-approval`: 承認カードを出して、利用者の許可を待っている
 */
export type ToolCallStatus = 'running' | 'awaiting-approval';

/**
 * 実行前に承認を求めたツールの、承認の結果（#148 Phase A2）。`expired` は待ち時間の上限に達した。
 */
export type ToolApproval = 'approved' | 'rejected' | 'expired';

/**
 * ファイルの書き込みの実行前に、利用者へ見せる内容（#148 Phase A2）。
 */
export type FileApprovalPreview = {
  /** 何をするか。`create` は新規作成、`overwrite` は上書き、`edit` は部分の置き換え */
  action: 'create' | 'overwrite' | 'edit';
  /** 対象のファイルの実体のパス */
  path: string;
  /** 変更の差分（unified diff） */
  diff: string;
  /** 追加する行数 */
  added: number;
  /** 削除する行数 */
  removed: number;
};

/**
 * コマンドの実行前に、利用者へ見せる内容（#148 Phase B。`docs/16-command-execution.md`）。
 */
export type CommandApprovalPreview = {
  /** 何をするか。常に `run`（コマンドの実行） */
  action: 'run';
  /** 実行する引数の配列を、区切りが分かるようにクォートし直した 1 行 */
  command: string;
  /** 実行ファイルの実体のパス（`PATH` から探した結果） */
  executable: string;
  /** 作業フォルダの実体のパス */
  cwd: string;
  /** 実行時間の上限（ミリ秒） */
  timeoutMs: number;
};

/**
 * 実行前に承認を求めるときに、利用者へ見せる内容。何をするか（`action`）で形が決まる。
 */
export type ApprovalPreview = FileApprovalPreview | CommandApprovalPreview;

/**
 * 画面で承認を待っているツールの実行（#148 Phase A2。`tool_approval_request` のイベントから作る）。
 */
export type ToolApprovalRequest = {
  /** 承認 ID（承認の API に渡す） */
  approvalId: string;
  /** ツール名 */
  name: string;
  /** 利用者へ見せる内容 */
  preview: ApprovalPreview;
  /** 承認を待っている応答のメッセージ ID。許可・拒否を返したら、その記録を「実行中」に戻す（#192） */
  messageId: string;
};

/**
 * エージェントが実行した 1 回のツール呼び出しの記録。
 *
 * サーバーのエージェントループが組み立て、`done` イベントで画面へ届き、
 * そのまま DB の `metadata.toolCalls` に保存される。
 */
export type ToolCallInfo = {
  /** 呼び出されたツール名 */
  name: string;
  /** ツールに渡された引数（キー名は各ツール定義に依存） */
  arguments: Record<string, unknown>;
  /** ツール実行結果の文字列表現（モデルへ返した文章そのもの） */
  result: string;
  /** 実行がエラー終了したかどうか */
  isError: boolean;
  /**
   * 結果パネルの見出しに出す短い要約（例: `5 件`、失敗の理由）。
   * 要約を持たない古いデータ・ツールでは省略される（#150）
   */
  summary?: string;
  /** 成功したが結果が空（検索の 0 件・本文なし）なら true。✅ と区別して表示する（#150） */
  isEmpty?: boolean;
  /** ツール実行にかかった時間（ミリ秒） */
  durationMs: number;
  /**
   * このツールを呼んだ時点で、応答の本文に届いていた文字数（#186）。
   * 本文をこの位置で区切り、説明 → ツールの結果 → 回答の順に並べて表示する。
   * サーバーのエージェントループが数える。#186 より前の古いデータは持たない
   */
  contentOffset?: number;
  /** 実行前に承認を求めたツールなら、その結果（{@link ToolApproval}）。承認の要らないツールは持たない */
  approval?: ToolApproval;
  /**
   * 結果が届く前なら、その状態（{@link ToolCallStatus}）。生成中の画面の仮の記録だけが持ち、結果が届いたら消す。
   * 保存する記録（サーバーから届いた結果）は持たない
   */
  status?: ToolCallStatus;
};
