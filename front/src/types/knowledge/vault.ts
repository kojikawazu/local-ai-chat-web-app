/**
 * 保管庫のファイルを取り込まない理由（#235。`docs/28-rag.md` の C3）。画面の表示の順もこの並び。
 *
 * - `not_text`: `.md`・`.markdown`・`.txt` 以外
 * - `hidden`: `.` で始まるフォルダ・ファイル（`.claude`・`.github` 等）の中
 * - `agent_config`: エージェントの設定（`CLAUDE.md`・`AGENTS.md`）
 * - `secret`: 秘匿ファイルの名前
 * - `too_large`: 1 MB を超える
 * - `not_file`: ふつうのファイルでない（シンボリックリンク・サブモジュール）
 */
export const VAULT_EXCLUSION_REASONS = [
  'not_text',
  'hidden',
  'agent_config',
  'secret',
  'too_large',
  'not_file',
] as const;

/** 保管庫のファイルを取り込まない理由。 */
export type VaultExclusionReason = (typeof VAULT_EXCLUSION_REASONS)[number];

/** 保管庫のどの版を読んだか（#235。`docs/28-rag.md` の C2・C8）。 */
export type VaultSource =
  | {
      /** git のリポジトリ（既定のブランチのコミット済みの中身） */
      kind: 'git';
      /** 読んだブランチ */
      branch: string;
      /** 読んだコミット（短い ID） */
      commit: string;
    }
  | {
      /** git でないフォルダ（今のフォルダの中身） */
      kind: 'folder';
    };

/** 同期の差分（#235）。 */
export type VaultSyncPlan = {
  /** 索引に無いパス（足す） */
  add: string[];
  /** 中身の版が変わったパス（取り込み直す） */
  update: string[];
  /** 版は同じだが、今の埋め込みのモデルと違うパス（作り直す） */
  rebuild: string[];
  /** 保管庫から消えたパス（索引から消す） */
  remove: string[];
  /** 何もしないファイルの数 */
  unchanged: number;
};

/** `POST /api/knowledge/vaults/[name]/plan` の応答（#235）。 */
export type VaultSyncPlanResponse = VaultSyncPlan & {
  /** 読んだ版 */
  source: VaultSource;
  /** 取り込まなかったファイルの、理由ごとの数（0 の理由は含めない） */
  excluded: { reason: VaultExclusionReason; count: number }[];
};

/**
 * `POST /api/knowledge/vaults/[name]/sync` の結果（#235）。
 *
 * `imported` は取り込んだ（作り直しを含む）、`unchanged` は何もしなかった、`removed` は索引から消した（無い・取り込まない
 * ファイル）、`rejected` は中身を取り込めなかった（テキストでない・空・チャンクが多すぎる。索引からも消す）。
 */
export type VaultFileSyncStatus =
  'imported' | 'unchanged' | 'removed' | 'rejected';

/** `GET /api/knowledge/vaults` の 1 件（#235）。 */
export type KnowledgeVaultItem = {
  /** 保管庫の名前（フォルダ名） */
  name: string;
  /** フォルダの実体のパス。設定に無い（索引だけ残っている）保管庫は `null` */
  root: string | null;
  /** `KNOWLEDGE_VAULTS` にあるか。無ければ検索に使わず、索引を消せる */
  configured: boolean;
  /** 読んだ版。設定に無い・読めないときは `null` */
  source: VaultSource | null;
  /** 読めないときの理由（フォルダが git の既定のブランチを持たない等）。読めれば `null` */
  error: string | null;
  /** 索引にあるファイルの数 */
  documentCount: number;
  /** 索引にあるチャンクの数 */
  chunkCount: number;
  /** 今の埋め込みのモデルと違うモデルで作ったファイルの数（同期で作り直す） */
  needsRebuildCount: number;
  /** 最後に中身が変わった日時（ISO 文字列。ドキュメントの `updatedAt` の最大）。索引が空なら `null` */
  lastUpdatedAt: string | null;
};

/** 同期の進み具合（#235。保管庫ごと）。 */
export type VaultSyncProgress = {
  /**
   * `planning` は差分を求めている、`syncing` は 1 ファイルずつ同期している、`done` は終わった、
   * `stopped` は利用者が止めた、`error` は途中で続けられなくなった（Ollama に繋がらない等）
   */
  phase: 'planning' | 'syncing' | 'done' | 'stopped' | 'error';
  /** 同期を終えたファイルの数 */
  done: number;
  /** 同期するファイルの数（差分の足す・変わった・作り直し・消えたの合計） */
  total: number;
  /** 取り込んだ（作り直しを含む）数 */
  imported: number;
  /** 索引から消した数 */
  removed: number;
  /** 何もしなかった数（差分で変わっていなかったものを含む） */
  unchanged: number;
  /** 取り込めなかったファイルと理由 */
  failures: { path: string; error: string }[];
  /** 取り込まなかったファイルの理由ごとの数（差分の結果） */
  excluded: { reason: VaultExclusionReason; count: number }[];
  /** 続けられなくなった理由（`error` のときだけ） */
  error?: string;
};
