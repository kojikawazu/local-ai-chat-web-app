'use client';

import { ShieldQuestion } from 'lucide-react';
import type {
  ApprovalPreview,
  BrowserActionApprovalPreview,
  BrowserOperation,
  CommandApprovalPreview,
  FileApprovalPreview,
  GitHubCommentApprovalPreview,
  GitHubCreatePrApprovalPreview,
  GitHubVisibility,
  ToolApprovalRequest,
} from '@/types/agent/tool-call';
import Button from '@/components/common/atoms/Button';

/** 差分を表示する最大の行数。超えた分は「ほか N 行」と書く（承認は全体に対して行う） */
const MAX_DIFF_LINES = 400;

/** 何をするかの見出し（ブラウザの操作は {@link BROWSER_TITLES}） */
const ACTION_TITLES: Record<
  Exclude<ApprovalPreview['action'], 'browser-action'>,
  string
> = {
  create: 'ファイルを作成します',
  overwrite: 'ファイルを上書きします',
  edit: 'ファイルを編集します',
  run: 'コマンドを実行します',
  'github-comment': 'GitHub にコメントします',
  'github-create-pr': 'GitHub に PR を作成します',
};

/** ブラウザの操作の見出し（操作の種類ごと。#149 Phase C） */
const BROWSER_TITLES: Record<BrowserOperation, string> = {
  click: 'ブラウザでクリックします',
  type: 'ブラウザで文字を入れます',
  select: 'ブラウザで選択します',
};

/**
 * 承認カードの見出しを決める。
 *
 * @param preview - 承認で見せる内容
 * @returns 何をするかの見出し
 */
function titleOf(preview: ApprovalPreview): string {
  return preview.action === 'browser-action'
    ? BROWSER_TITLES[preview.operation]
    : ACTION_TITLES[preview.action];
}

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
 * ファイルの書き込みの、対象のパスと差分（追加は緑・削除は赤）。
 * 差分は {@link MAX_DIFF_LINES} 行まで出し、超えた分は行数だけを書く。
 *
 * @param props - 承認で見せる内容を持つ props
 * @param props.preview - ファイルの書き込みの内容
 */
function FilePreview({ preview }: { preview: FileApprovalPreview }) {
  const lines = preview.diff.split('\n');
  const shown = lines.slice(0, MAX_DIFF_LINES);
  const hidden = lines.length - shown.length;
  return (
    <>
      <p className="text-xs text-nord-4/80 break-all font-mono">
        {preview.path}（+{preview.added} −{preview.removed}）
      </p>
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
    </>
  );
}

/**
 * コマンドの実行の、コマンド・実行ファイル・作業フォルダ・時間の上限（#148 Phase B）。
 *
 * コマンドは、モデルが書いた文字列ではなく、実際に渡す引数の区切りが分かる形（クォートし直したもの）を出す。
 *
 * @param props - 承認で見せる内容を持つ props
 * @param props.preview - コマンドの実行の内容
 */
function CommandPreview({ preview }: { preview: CommandApprovalPreview }) {
  return (
    <>
      <pre
        aria-label="実行するコマンド"
        className="overflow-x-auto rounded-lg bg-nord-0 border border-nord-3 p-3 text-xs leading-relaxed font-mono text-nord-6 whitespace-pre-wrap break-all"
      >
        $ {preview.command}
      </pre>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-nord-4/60">作業フォルダ</dt>
        <dd className="text-nord-4/80 break-all font-mono">{preview.cwd}</dd>
        <dt className="text-nord-4/60">実行ファイル</dt>
        <dd className="text-nord-4/80 break-all font-mono">
          {preview.executable}
        </dd>
        <dt className="text-nord-4/60">時間の上限</dt>
        <dd className="text-nord-4/80">
          {Number((preview.timeoutMs / 1000).toFixed(1))} 秒
        </dd>
      </dl>
    </>
  );
}

/**
 * GitHub のリポジトリと、公開リポジトリなら誰でも読める旨（#148 Phase C）。
 * ローカルの内容を外へ出してよいかの判断材料にする。
 *
 * @param props - リポジトリと公開・非公開を持つ props
 * @param props.repo - リポジトリ（`owner/name`）
 * @param props.visibility - 公開か非公開か
 */
function RepoLine({
  repo,
  visibility,
}: {
  repo: string;
  visibility: GitHubVisibility;
}) {
  return (
    <>
      <dt className="text-nord-4/60">リポジトリ</dt>
      <dd className="text-nord-4/80 break-all font-mono">
        {repo}（{visibility === 'public' ? '公開' : '非公開'}）
      </dd>
    </>
  );
}

/**
 * 送る本文。Markdown として描かず、送る文字のまま出す（仕込まれた画像・リンク・HTML のコメントも見えるように）。
 *
 * @param props - 本文を持つ props
 * @param props.body - 送る本文
 * @param props.visibility - 公開か非公開か（公開なら注意を出す）
 */
function GitHubBody({
  body,
  visibility,
}: {
  body: string;
  visibility: GitHubVisibility;
}) {
  return (
    <>
      <pre
        aria-label="送る本文"
        className="max-h-96 overflow-auto rounded-lg bg-nord-0 border border-nord-3 p-3 text-xs leading-relaxed font-mono text-nord-6 whitespace-pre-wrap break-words"
      >
        {body}
      </pre>
      {visibility === 'public' && (
        <p role="note" className="text-xs text-nord-aurora-yellow">
          公開リポジトリです。送った内容は誰でも読めます
        </p>
      )}
    </>
  );
}

/**
 * GitHub の PR・issue へのコメントの、リポジトリ・コメント先・本文（#148 Phase C）。
 *
 * @param props - 承認で見せる内容を持つ props
 * @param props.preview - コメントの内容
 */
function GitHubCommentPreview({
  preview,
}: {
  preview: GitHubCommentApprovalPreview;
}) {
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <RepoLine repo={preview.repo} visibility={preview.visibility} />
        <dt className="text-nord-4/60">コメント先</dt>
        <dd className="text-nord-4/80 break-all">
          {preview.kind === 'pr' ? 'PR' : 'issue'} #{preview.number}{' '}
          {preview.targetTitle}
        </dd>
      </dl>
      <GitHubBody body={preview.body} visibility={preview.visibility} />
    </>
  );
}

/**
 * GitHub の PR の作成の、リポジトリ・ブランチ・タイトル・本文（#148 Phase C）。
 *
 * @param props - 承認で見せる内容を持つ props
 * @param props.preview - PR の作成の内容
 */
function GitHubCreatePrPreview({
  preview,
}: {
  preview: GitHubCreatePrApprovalPreview;
}) {
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <RepoLine repo={preview.repo} visibility={preview.visibility} />
        <dt className="text-nord-4/60">ブランチ</dt>
        <dd className="text-nord-4/80 break-all font-mono">
          {preview.head} → {preview.base}
          {preview.draft && '（下書き）'}
        </dd>
        <dt className="text-nord-4/60">タイトル</dt>
        <dd className="text-nord-6 break-all">{preview.title}</dd>
      </dl>
      <GitHubBody body={preview.body} visibility={preview.visibility} />
    </>
  );
}

/**
 * ブラウザの操作の、ページ・要素・入れる文字や選ぶ項目（#149 Phase C。`docs/18-browser-tools.md`「Phase C: 操作のツール」）。
 *
 * 要素は、モデルの説明ではなく参照から引いた実際の役割と名前を出す。入れる文字は Markdown として描かず、そのまま出す。
 *
 * @param props - 承認で見せる内容を持つ props
 * @param props.preview - ブラウザの操作の内容
 */
function BrowserActionPreview({
  preview,
}: {
  preview: BrowserActionApprovalPreview;
}) {
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-nord-4/60">ページ</dt>
        <dd className="text-nord-4/80 break-all">
          {preview.title || '（タイトルなし）'}（
          {preview.local ? '手元の開発サーバー' : '公開のページ'}）
          <span className="block font-mono">{preview.url}</span>
        </dd>
        <dt className="text-nord-4/60">要素</dt>
        <dd
          aria-label="操作する要素"
          className="text-nord-6 break-all font-mono"
        >
          {preview.element}
        </dd>
        {preview.operation === 'select' && (
          <>
            <dt className="text-nord-4/60">選ぶ項目</dt>
            <dd className="text-nord-6 break-all">{preview.value}</dd>
          </>
        )}
      </dl>
      {preview.operation === 'type' && (
        <>
          <pre
            aria-label="入れる文字"
            className="max-h-60 overflow-auto rounded-lg bg-nord-0 border border-nord-3 p-3 text-xs leading-relaxed font-mono text-nord-6 whitespace-pre-wrap break-words"
          >
            {preview.value || '（空にする）'}
          </pre>
          {preview.submit && (
            <p className="text-xs text-nord-4/80">
              入れた後に Enter を押します
            </p>
          )}
        </>
      )}
      {!preview.local && preview.operation === 'type' && (
        <p role="note" className="text-xs text-nord-aurora-yellow">
          公開のページです。入れた文字はページの持ち主へ送られることがあります
        </p>
      )}
    </>
  );
}

/**
 * 承認で見せる内容を、何をするか（`action`）で出し分ける。
 *
 * @param props - 承認で見せる内容を持つ props
 * @param props.preview - 承認で見せる内容
 */
function PreviewBody({ preview }: { preview: ApprovalPreview }) {
  switch (preview.action) {
    case 'run':
      return <CommandPreview preview={preview} />;
    case 'github-comment':
      return <GitHubCommentPreview preview={preview} />;
    case 'github-create-pr':
      return <GitHubCreatePrPreview preview={preview} />;
    case 'browser-action':
      return <BrowserActionPreview preview={preview} />;
    default:
      return <FilePreview preview={preview} />;
  }
}

/**
 * ツールの実行前の承認カード（#148 Phase A2・Phase B・Phase C、#149 Phase C。`docs/15-tool-approval.md`・`docs/16-command-execution.md`・
 * `docs/17-github-tools.md`・`docs/18-browser-tools.md`）。
 *
 * 何をするかの見出しと、その中身（ファイルの書き込みなら差分、コマンドの実行ならコマンドと作業フォルダ、
 * GitHub への書き込みならリポジトリと送る本文、ブラウザの操作ならページと要素）、
 * 「許可」「拒否」のボタンを出す。
 *
 * @param props - 承認を待っている実行・残りの数・答えたときの処理を持つ props
 */
export default function ApprovalCard({
  request,
  remaining,
  onRespond,
}: ApprovalCardProps) {
  const { preview } = request;

  return (
    <section
      aria-label="ツールの実行の承認"
      className="rounded-xl border border-nord-aurora-yellow/60 bg-nord-1 p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <ShieldQuestion
          size={20}
          className="shrink-0 text-nord-aurora-yellow"
        />
        <h3 className="font-bold text-nord-6">{titleOf(preview)}</h3>
      </div>

      <PreviewBody preview={preview} />

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
