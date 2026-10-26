'use client';

import { ShieldQuestion } from 'lucide-react';
import type { ToolApprovalRequest } from '@/types/agent/tool-call';
import Button from '@/components/common/atoms/Button';

/** 差分を表示する最大の行数。超えた分は「ほか N 行」と書く（承認は全体に対して行う） */
const MAX_DIFF_LINES = 400;

/** 何をするかの見出し */
const ACTION_TITLES: Record<ToolApprovalRequest['preview']['action'], string> =
  {
    create: 'ファイルを作成します',
    overwrite: 'ファイルを上書きします',
    edit: 'ファイルを編集します',
  };

/** {@link ApprovalCard} の props。 */
type ApprovalCardProps = {
  /** 承認を待っているツールの実行 */
  request: ToolApprovalRequest;
  /** このほかに承認を待っている数（順に出す） */
  remaining: number;
  /** 許可・拒否のボタンで呼ぶ。許可なら true を受け取る */
  onRespond: (approved: boolean) => void;
};

/**
 * 差分の 1 行の色を決める。見出し（`---` / `+++`）は追加・削除と見分ける。
 *
 * @param line - 差分の 1 行
 * @returns 行に付けるクラス
 */
function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-nord-4/60';
  if (line.startsWith('+'))
    return 'text-nord-aurora-green bg-nord-aurora-green/10';
  if (line.startsWith('-')) return 'text-nord-aurora-red bg-nord-aurora-red/10';
  if (line.startsWith('@@')) return 'text-nord-frost-1';
  return 'text-nord-4';
}

/**
 * ツールの実行前の承認カード（#148 Phase A2。`docs/15-tool-approval.md`）。
 *
 * 何をするか・対象のパス・差分（追加は緑・削除は赤）と、「許可」「拒否」のボタンを出す。
 * 差分は {@link MAX_DIFF_LINES} 行まで出し、超えた分は行数だけを書く。
 *
 * @param props - 承認を待っている実行・残りの数・答えたときの処理を持つ props
 */
export default function ApprovalCard({
  request,
  remaining,
  onRespond,
}: ApprovalCardProps) {
  const { preview } = request;
  const lines = preview.diff.split('\n');
  const shown = lines.slice(0, MAX_DIFF_LINES);
  const hidden = lines.length - shown.length;

  return (
    <section
      aria-label="ツールの実行の承認"
      className="rounded-xl border border-nord-aurora-yellow/60 bg-nord-1 p-4 space-y-3"
    >
      <div className="flex items-start gap-2">
        <ShieldQuestion
          size={20}
          className="shrink-0 mt-0.5 text-nord-aurora-yellow"
        />
        <div className="min-w-0">
          <h3 className="font-bold text-nord-6">
            {ACTION_TITLES[preview.action]}（+{preview.added} −{preview.removed}
            ）
          </h3>
          <p className="text-xs text-nord-4/80 break-all font-mono">
            {preview.path}
          </p>
        </div>
      </div>

      <pre
        aria-label="変更の差分"
        className="max-h-96 overflow-auto rounded-lg bg-nord-0 border border-nord-3 p-3 text-xs leading-relaxed font-mono"
      >
        {shown.map((line, index) => (
          <div key={index} className={diffLineClass(line)}>
            {line || ' '}
          </div>
        ))}
        {hidden > 0 && (
          <div className="text-nord-4/60">（ほか {hidden} 行）</div>
        )}
      </pre>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-nord-4/60">
          {request.name} が実行の許可を求めています
          {remaining > 0 && `（ほかに ${remaining} 件が待っています）`}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => onRespond(false)}>
            拒否
          </Button>
          <Button onClick={() => onRespond(true)}>許可</Button>
        </div>
      </div>
    </section>
  );
}
