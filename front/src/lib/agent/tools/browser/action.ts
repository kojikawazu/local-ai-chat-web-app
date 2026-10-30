import type { Locator } from 'playwright-core';
import type {
  BrowserActionApprovalPreview,
  BrowserOperation,
} from '@/types/agent/tool-call';
import type {
  PreparedAction,
  Tool,
  ToolDefinition,
  ToolExecution,
} from '../types';
import { toolError, toolNeedsApproval } from '../output';
import type { BrowserSession } from './session';
import { getOpenedPage } from './session';
import { formatPageResult, takeSnapshot } from './snapshot';
import { findElement, parseRef } from './element';
import {
  BROWSER_EXCLUSIVE,
  BROWSER_NO_CONTEXT_REASON,
  BROWSER_NOT_OPENED_REASON,
} from '@/constants/agent/browser';

/** 操作の種類の表示名（結果の要約の頭に付ける） */
const OPERATION_LABELS: Record<BrowserOperation, string> = {
  click: 'クリック',
  type: '入力',
  select: '選択',
};

/** 操作のツールが引数から読んだ値。 */
export type ActionArgs = {
  /** 入れる文字（type）・選ぶ項目（select） */
  value?: string;
  /** 入れた後に Enter を押すか（type） */
  submit?: boolean;
};

/** 要素を確かめた結果。操作できるなら、許可された後に行う操作を持つ。 */
export type ElementCheck =
  | {
      ok: true;
      /**
       * 要素を操作する
       *
       * @param locator - 操作する要素
       * @returns 操作が終わったら解決する Promise
       */
      perform: (locator: Locator) => Promise<void>;
    }
  | { ok: false; reason: string };

/** {@link createBrowserActionTool} に渡す、操作のツールごとの違い。 */
type ActionSpec = {
  /** 操作の種類 */
  operation: BrowserOperation;
  /** ツールの定義（モデルへ渡す） */
  definition: ToolDefinition;
  /**
   * 引数（`ref` 以外）を確かめる。ページに触れる前に行う
   *
   * @param args - モデルが渡した引数
   * @returns 読んだ値、または確かめられない理由
   */
  parseArgs: (
    args: Record<string, unknown>
  ) => { ok: true; value: ActionArgs } | { ok: false; reason: string };
  /**
   * 要素がこの操作をできるものかを確かめ、許可された後に行う操作を作る
   *
   * @param locator - 参照で指した要素
   * @param element - 要素を表す文字（`textbox "名前"`。断る理由に使う）
   * @param parsed - {@link ActionSpec.parseArgs} で読んだ値
   * @returns 操作、または断る理由
   */
  checkElement: (
    locator: Locator,
    element: string,
    parsed: ActionArgs
  ) => Promise<ElementCheck>;
};

/**
 * 操作の結果の要約（画面の 1 行）を作る（#149 Phase C）。
 *
 * @param operation - 操作の種類
 * @param element - 操作した要素（`button "送信する"`）
 * @param value - 選んだ項目（select のときだけ書く。入れた文字は長いことがあるため書かない）
 * @returns `クリック: button "送信する"`・`選択: combobox "種別" → 要望` の形
 */
export function actionSummary(
  operation: BrowserOperation,
  element: string,
  value?: string
): string {
  const head = `${OPERATION_LABELS[operation]}: ${element}`;
  return operation === 'select' && value !== undefined
    ? `${head} → ${value}`
    : head;
}

/**
 * 操作の間に起きたことを、結果の前に書く文章にする（#149 Phase C）。
 *
 * @param happened - 起きたこと
 * @param happened.fromUrl - 操作の前のページの URL
 * @param happened.toUrl - 操作の後のページの URL
 * @param happened.notices - 操作の間に増えたページの記録（閉じたダイアログ・新しいウィンドウ）
 * @param happened.blocked - 操作の間にプロキシが止めた接続
 * @returns 1 行ずつの文章。何も起きていなければ空文字
 */
export function formatHappened(happened: {
  fromUrl: string;
  toUrl: string;
  notices: readonly string[];
  blocked: readonly string[];
}): string {
  return [
    ...(happened.toUrl !== happened.fromUrl
      ? [`ページが移りました: ${happened.toUrl}`]
      : []),
    ...happened.notices,
    ...happened.blocked.map((target) => `止めた接続: ${target}`),
  ].join('\n');
}

/**
 * 許可された操作を行い、操作の後のページを読んで結果にする。
 *
 * 承認を待つ間にページが変わっていたら（URL・要素の役割と名前が準備のときと違う）、操作しない。
 *
 * @param session - この応答のブラウザのセッション
 * @param prepared - 準備で決めたこと
 * @param prepared.ref - 要素の参照
 * @param prepared.preview - 承認カードに出した内容
 * @param prepared.perform - 要素を操作する
 * @param signal - ツールのタイムアウト・停止で中断される signal
 * @returns 実行結果
 */
async function performAction(
  session: BrowserSession,
  prepared: {
    ref: string;
    preview: BrowserActionApprovalPreview;
    perform: (locator: Locator) => Promise<void>;
  },
  signal: AbortSignal
): Promise<ToolExecution> {
  const { ref, preview, perform } = prepared;
  const page = session.openedPage();
  if (!page) {
    return toolError(
      '承認を待つ間にページが閉じられたため、操作しませんでした。browser_navigate で開き直してください'
    );
  }
  if (page.url() !== preview.url) {
    return toolError(
      '承認を待つ間にページが移ったため、操作しませんでした。browser_snapshot で読み直してください'
    );
  }
  const found = await findElement(page, ref);
  if (!found.ok) return toolError(found.reason);
  if (found.element !== preview.element) {
    return toolError(
      `承認を待つ間に要素が変わった（${preview.element} → ${found.element}）ため、操作しませんでした。browser_snapshot で読み直してください`
    );
  }

  const noticesBefore = session.notices.length;
  const blockedBefore = session.proxy.blocked.length;
  // Playwright の操作は signal を受けないため、停止・タイムアウトではページを閉じて操作を止める
  // （同じ応答の次の呼び出しでは、ページを開き直すよう促す）
  const abort = () => void page.close().catch(() => {});
  signal.addEventListener('abort', abort, { once: true });
  try {
    try {
      await perform(found.locator);
    } catch (e) {
      session.syncTopPage(page);
      if (signal.aborted) return toolError('操作を中断しました');
      return toolError(
        `操作できませんでした: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`
      );
    }
    await session.waitForQuiet();

    const url = page.url();
    const happened = formatHappened({
      fromUrl: preview.url,
      toUrl: url,
      notices: session.notices.slice(noticesBefore),
      blocked: session.proxy.blocked.slice(blockedBefore),
    });
    const summary = actionSummary(
      preview.operation,
      preview.element,
      preview.value
    );
    const readLocal = session.isLocalUrl(url);
    let output;
    try {
      output = formatPageResult({
        url,
        title: await page.title(),
        snapshot: await takeSnapshot(page),
        offset: 0,
      });
    } catch {
      // 操作でページが移る途中などで読めなかった。操作はしたため、成功として読み直しを促す
      return {
        result: `操作しました（${summary}）。${happened ? `\n${happened}\n` : ''}操作の後のページは読めませんでした。browser_snapshot で読み直してください。`,
        isError: false,
        summary,
        readLocal,
      };
    }
    return {
      ...output,
      result: `操作しました（${summary}）。\n${happened ? `${happened}\n` : ''}\n${output.result}`,
      summary,
      readLocal,
    };
  } catch (e) {
    if (signal.aborted) return toolError('操作を中断しました');
    return toolError(
      `操作の後のページを読めませんでした: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`
    );
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/**
 * ページを操作するツール（クリック・入力・選択）を作る（#149 Phase C。`docs/18-browser-tools.md`「Phase C: 操作のツール」）。
 *
 * 実行前に承認が要る。準備（`prepare`）で、この応答で開いたページから参照で要素を探し、役割と名前を引いて承認カードに出す
 * （モデルの説明ではなく、実際に操作する要素を見せる）。許可されたら、ページと要素が準備のときと同じかを確かめてから操作し、
 * 操作の後のページを返す。手元の情報を読んだ後は、公開のページを操作しない（入れた文字を外へ送りうるため）。
 * 操作の後のページが手元の開発サーバーなら、結果の `readLocal` で知らせる。
 *
 * @param localOrigins - 開いてよい手元の開発サーバー（`BROWSER_LOCAL_ORIGINS`）。承認カードの公開／手元に使う
 * @param spec - 操作のツールごとの違い
 * @returns 操作のツール
 */
export function createBrowserActionTool(
  localOrigins: readonly string[],
  spec: ActionSpec
): Tool {
  return {
    exclusive: BROWSER_EXCLUSIVE,
    definition: spec.definition,
    async execute() {
      return toolNeedsApproval();
    },
    async prepare(args, _signal, context): Promise<PreparedAction> {
      const fail = (reason: string, readLocal?: boolean): PreparedAction => ({
        ok: false,
        output: { ...toolError(reason), readLocal },
      });
      if (!context) return fail(BROWSER_NO_CONTEXT_REASON);
      const ref = parseRef(args.ref);
      if (!ref.ok) return fail(ref.reason);
      const parsed = spec.parseArgs(args);
      if (!parsed.ok) return fail(parsed.reason);

      const opened = await getOpenedPage(context);
      if (!opened) return fail(BROWSER_NOT_OPENED_REASON);
      const { page, session } = opened;
      const url = page.url();
      const local = session.isLocalUrl(url);
      if (!local && context.hasReadLocal()) {
        return fail(
          'この応答で手元の情報を読んだため、公開のページは操作できません（入れた文字や操作が外へ送られうるため）'
        );
      }
      // 断る理由には要素の名前（ページの内容）が入るため、手元のページなら手元を読んだとして知らせる
      const found = await findElement(page, ref.value);
      if (!found.ok) return fail(found.reason, local);
      const checked = await spec.checkElement(
        found.locator,
        found.element,
        parsed.value
      );
      if (!checked.ok) return fail(checked.reason, local);

      const preview: BrowserActionApprovalPreview = {
        action: 'browser-action',
        operation: spec.operation,
        url,
        title: await page.title(),
        local,
        element: found.element,
        ...(parsed.value.value !== undefined && { value: parsed.value.value }),
        ...(parsed.value.submit !== undefined && {
          submit: parsed.value.submit,
        }),
      };
      return {
        ok: true,
        preview,
        run: (signal) =>
          performAction(
            session,
            { ref: ref.value, preview, perform: checked.perform },
            signal
          ),
      };
    },
  };
}
