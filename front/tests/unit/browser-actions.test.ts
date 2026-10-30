import { describe, it, expect } from 'vitest';
import type { ToolContext } from '@/lib/agent/tools/types';
import { createInOrderQueue } from '@/lib/agent/agent';
import {
  describeElementLine,
  findRefLine,
  parseRef,
} from '@/lib/agent/tools/browser/element';
import {
  actionSummary,
  formatHappened,
} from '@/lib/agent/tools/browser/action';
import { createBrowserClickTool } from '@/lib/agent/tools/browser/click';
import {
  createBrowserTypeTool,
  parseSubmit,
} from '@/lib/agent/tools/browser/type';
import {
  createBrowserSelectTool,
  findOptionIndex,
} from '@/lib/agent/tools/browser/select';
import {
  BROWSER_EXCLUSIVE,
  BROWSER_NO_CONTEXT_REASON,
  BROWSER_NOT_OPENED_REASON,
} from '@/constants/agent/browser';

/**
 * ブラウザの操作のツール（#149 Phase C。`docs/18-browser-tools.md`「Phase C: 操作のツール」）の純ロジックの UT。
 *
 * ページに触れる前に決まること（引数・参照の形・要素の行の読み方・結果の文章・順に実行する仕組み）を確かめる。
 * Chromium で要素を探して操作する流れは IT（chat-agent-browser-actions.test.ts）、承認カードの表示は E2E が担う。
 */

const LOCAL = ['http://localhost:5173'];

/**
 * まだページを開いていない、応答ごとの文脈を作る（`scope` が空なので、ブラウザのセッションは無い）。
 *
 * @returns 文脈
 */
function emptyContext(): ToolContext {
  return {
    scope: new Map(),
    onDispose: () => {},
    hasReadLocal: () => false,
  };
}

/**
 * ツールの準備を、文脈付きで呼ぶ。操作のツールは必ず `prepare` を持つ。
 *
 * @param tool - 操作のツール
 * @param args - 引数
 * @param context - 応答ごとの文脈（省略するとループの外からの呼び出し）
 * @returns 準備の結果
 */
function prepare(
  tool: ReturnType<typeof createBrowserClickTool>,
  args: Record<string, unknown>,
  context?: ToolContext
) {
  // 操作のツールは createBrowserActionTool が必ず prepare を付ける。無ければテストの前提が崩れているため落とす
  if (!tool.prepare) throw new Error('prepare がありません');
  return tool.prepare(args, new AbortController().signal, context);
}

describe('正常系', () => {
  it('参照はスナップショットの e12・iframe の f1e3 の形を読み、[ref=…] の囲みは外す', () => {
    expect(parseRef('e12')).toEqual({ ok: true, value: 'e12' });
    expect(parseRef('f1e3')).toEqual({ ok: true, value: 'f1e3' });
    expect(parseRef('[ref=e5]')).toEqual({ ok: true, value: 'e5' });
    expect(parseRef(' ref=e7 ')).toEqual({ ok: true, value: 'e7' });
  });

  it('要素の行から役割と名前だけを取る（値・状態・参照は含めない）', () => {
    expect(describeElementLine('- button "送信する"')).toBe(
      'button "送信する"'
    );
    expect(describeElementLine('- textbox "名前": 田中')).toBe(
      'textbox "名前"'
    );
    expect(describeElementLine('- checkbox "同意する" [checked]')).toBe(
      'checkbox "同意する"'
    );
    expect(
      describeElementLine('- link "別のページ" [ref=e12]:\n  - /url: /next')
    ).toBe('link "別のページ"');
    expect(describeElementLine('- list')).toBe('list');
  });

  it('スナップショットから参照の行を探す（e1 で e12 の行には当てない）', () => {
    const snapshot = [
      '- generic [ref=e1]:',
      '  - button "送信する" [ref=e12]',
      '  - iframe [ref=e3]:',
      '    - button "中" [ref=f1e2]',
    ].join('\n');
    expect(findRefLine(snapshot, 'e12')).toBe('- button "送信する" [ref=e12]');
    expect(findRefLine(snapshot, 'e1')).toBe('- generic [ref=e1]:');
    expect(findRefLine(snapshot, 'f1e2')).toBe('- button "中" [ref=f1e2]');
  });

  it('名前の中の \\" はそのまま名前に含める', () => {
    expect(describeElementLine('- button "「\\"保存\\"」する"')).toBe(
      'button "「\\"保存\\"」する"'
    );
  });

  it('submit は真偽値と "true"・"false" を読み、省略は false', () => {
    expect(parseSubmit(true)).toBe(true);
    expect(parseSubmit('false')).toBe(false);
    expect(parseSubmit('true')).toBe(true);
    expect(parseSubmit(undefined)).toBe(false);
  });

  it('選ぶ項目は表示の文字で探し、無ければ値で探す', () => {
    const options = [
      { label: '質問', value: 'q', disabled: false },
      { label: '要望', value: 'r', disabled: false },
    ];
    expect(findOptionIndex(options, ' 要望 ')).toBe(1);
    expect(findOptionIndex(options, 'q')).toBe(0);
  });

  it('要約は操作と要素を書き、選択では選んだ項目も書く', () => {
    expect(actionSummary('click', 'button "送信する"')).toBe(
      'クリック: button "送信する"'
    );
    expect(actionSummary('type', 'textbox "名前"', '田中')).toBe(
      '入力: textbox "名前"'
    );
    expect(actionSummary('select', 'combobox "種別"', '要望')).toBe(
      '選択: combobox "種別" → 要望'
    );
  });

  it('操作の間に起きたこと（移動・ダイアログ・止めた接続）を 1 行ずつ書く', () => {
    expect(
      formatHappened({
        fromUrl: 'http://localhost:5173/',
        toUrl: 'http://localhost:5173/done',
        notices: ['ダイアログ（confirm）「消しますか？」をキャンセルしました'],
        blocked: ['127.0.0.1:5499（許可していない手元のアドレス）'],
      })
    ).toBe(
      [
        'ページが移りました: http://localhost:5173/done',
        'ダイアログ（confirm）「消しますか？」をキャンセルしました',
        '止めた接続: 127.0.0.1:5499（許可していない手元のアドレス）',
      ].join('\n')
    );
  });

  it('同じ組の処理は、前の処理が終わってから呼ばれた順に始める', async () => {
    const inOrder = createInOrderQueue();
    const log: string[] = [];
    let releaseFirst = () => {};
    const first = inOrder('browser', async () => {
      log.push('1 開始');
      await new Promise<void>((resolve) => (releaseFirst = resolve));
      log.push('1 終了');
    });
    const second = inOrder('browser', async () => {
      log.push('2 開始');
    });
    // 1 つ目が終わるまで、2 つ目は始まらない
    await Promise.resolve();
    expect(log).toEqual(['1 開始']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(log).toEqual(['1 開始', '1 終了', '2 開始']);
  });

  it('操作の 3 つのツールはブラウザの組に入り、実行前に承認を求める', () => {
    for (const tool of [
      createBrowserClickTool(LOCAL),
      createBrowserTypeTool(LOCAL),
      createBrowserSelectTool(LOCAL),
    ]) {
      expect(tool.exclusive).toBe(BROWSER_EXCLUSIVE);
      expect(tool.prepare).toBeTypeOf('function');
      expect(tool.access).toBeUndefined();
    }
  });
});

describe('準正常系', () => {
  it('参照の形でない値は読めない', () => {
    for (const raw of ['', 'button', '12', 'e', 'e12; e13', 'x1e2', 12, null]) {
      expect(parseRef(raw).ok).toBe(false);
    }
  });

  it('スナップショットに無い参照の行は見つからない', () => {
    expect(findRefLine('- button "送信する" [ref=e12]', 'e2')).toBeUndefined();
  });

  it('要素の行の形でなければ読めない', () => {
    expect(describeElementLine('')).toBeUndefined();
    expect(describeElementLine('button "送信"')).toBeUndefined();
  });

  it('submit が真偽値でも "true"・"false" でもなければ読めない', () => {
    expect(parseSubmit('yes')).toBeUndefined();
    expect(parseSubmit(1)).toBeUndefined();
  });

  it('無い項目は見つからない', () => {
    expect(
      findOptionIndex([{ label: '質問', value: 'q', disabled: false }], '要望')
    ).toBe(-1);
  });

  it('何も起きていなければ、前置きは空', () => {
    expect(
      formatHappened({
        fromUrl: 'http://localhost:5173/',
        toUrl: 'http://localhost:5173/',
        notices: [],
        blocked: [],
      })
    ).toBe('');
  });

  it('前の処理が失敗しても、続きの処理は進める', async () => {
    const inOrder = createInOrderQueue();
    const first = inOrder('browser', async () => {
      throw new Error('失敗');
    });
    const second = inOrder('browser', async () => '2 つ目');
    await expect(first).rejects.toThrow('失敗');
    await expect(second).resolves.toBe('2 つ目');
  });

  it('組の名前が無ければ、ほかの組の処理が終わらなくても待たずに始める', async () => {
    const inOrder = createInOrderQueue();
    const log: string[] = [];
    // 終わらない処理で組を塞ぐ
    void inOrder('browser', () => new Promise<void>(() => log.push('組 1')));
    void inOrder('browser', async () => {
      log.push('組 2');
    });
    void inOrder(undefined, async () => {
      log.push('組なし');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).toContain('組なし');
    expect(log).not.toContain('組 2');
  });

  it('まだページを開いていなければ、承認を求めずに失敗する', async () => {
    const prepared = await prepare(
      createBrowserClickTool(LOCAL),
      { ref: 'e1' },
      emptyContext()
    );
    expect(prepared).toEqual({
      ok: false,
      output: expect.objectContaining({
        isError: true,
        summary: BROWSER_NOT_OPENED_REASON,
      }),
    });
  });

  it('入力の text・submit と選択の value は、ページに触れる前に確かめる', async () => {
    const context = emptyContext();
    const cases: [ReturnType<typeof createBrowserClickTool>, object][] = [
      [createBrowserClickTool(LOCAL), { ref: 'button' }],
      [createBrowserTypeTool(LOCAL), { ref: 'e1' }],
      [createBrowserTypeTool(LOCAL), { ref: 'e1', text: 'a'.repeat(5_001) }],
      [createBrowserTypeTool(LOCAL), { ref: 'e1', text: 'a', submit: 'yes' }],
      [createBrowserSelectTool(LOCAL), { ref: 'e1', value: ' ' }],
      [createBrowserSelectTool(LOCAL), { ref: 'e1', value: 'a'.repeat(501) }],
    ];
    for (const [tool, args] of cases) {
      const prepared = await prepare(tool, { ...args }, context);
      expect(prepared.ok).toBe(false);
      // 引数で断ったため、ページを開いていないことの理由にはならない
      expect(prepared).not.toMatchObject({
        output: { summary: BROWSER_NOT_OPENED_REASON },
      });
    }
  });
});

describe('異常系', () => {
  it('ループの外から（文脈なしで）準備を呼ぶと失敗する', async () => {
    const prepared = await prepare(createBrowserClickTool(LOCAL), {
      ref: 'e1',
    });
    expect(prepared).toEqual({
      ok: false,
      output: expect.objectContaining({ summary: BROWSER_NO_CONTEXT_REASON }),
    });
  });

  it('承認を経ずに execute を呼んでも操作しない', async () => {
    const result = await createBrowserClickTool(LOCAL).execute(
      { ref: 'e1' },
      new AbortController().signal,
      emptyContext()
    );
    expect(result.isError).toBe(true);
  });
});
