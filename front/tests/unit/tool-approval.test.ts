import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveApproval, waitForApproval } from '@/lib/agent/approvals';
import { declinedOutput } from '@/lib/agent/agent';
import {
  countOccurrences,
  planEdit,
} from '@/lib/agent/tools/local-files/edit-file';
import {
  buildPreview,
  describePreview,
} from '@/lib/agent/tools/local-files/diff';
import { findUnwritableSegment } from '@/lib/agent/tools/local-files/write-guard';
import { parseApprovalBody } from '@/lib/server/request-body';

/**
 * ツールの承認とファイルの書き込み（#148 Phase A2）の純ロジックの UT。
 * 承認待ちの決着（許可・拒否・時間切れ・停止）は偽のタイマーで確かめる（実際の 5 分を待たない）。
 * fs に触れる書き込みの流れと /api/chat を通した承認は IT（local-file-write.test.ts・chat-agent-approval.test.ts）が担う。
 */

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForApproval / resolveApproval', () => {
  describe('正常系', () => {
    it('承認の API から許可・拒否が届くと、その結果で決着する', async () => {
      const signal = new AbortController().signal;
      const approved = waitForApproval({ id: 'a-1', signal });
      const rejected = waitForApproval({ id: 'a-2', signal });

      expect(resolveApproval('a-1', true)).toBe(true);
      expect(resolveApproval('a-2', false)).toBe(true);
      await expect(approved).resolves.toBe('approved');
      await expect(rejected).resolves.toBe('rejected');
    });
  });

  describe('準正常系', () => {
    it('待ち時間の上限に達したら expired で決着し、その後の承認は受け付けない', async () => {
      vi.useFakeTimers();
      const waiting = waitForApproval({
        id: 'a-3',
        signal: new AbortController().signal,
        timeoutMs: 1000,
      });

      vi.advanceTimersByTime(1000);
      await expect(waiting).resolves.toBe('expired');
      expect(resolveApproval('a-3', true)).toBe(false);
    });

    it('停止・切断（signal の中断）で取り消し、rejected で決着する', async () => {
      const controller = new AbortController();
      const waiting = waitForApproval({ id: 'a-4', signal: controller.signal });

      controller.abort();
      await expect(waiting).resolves.toBe('rejected');
      expect(resolveApproval('a-4', true)).toBe(false);
    });

    it('中断済みの signal なら登録せずに rejected', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        waitForApproval({ id: 'a-5', signal: controller.signal })
      ).resolves.toBe('rejected');
      expect(resolveApproval('a-5', true)).toBe(false);
    });
  });

  describe('異常系', () => {
    it('知らない ID・決着済みの ID には false を返す（承認の API は 404）', async () => {
      expect(resolveApproval('unknown', true)).toBe(false);
      const waiting = waitForApproval({
        id: 'a-6',
        signal: new AbortController().signal,
      });
      resolveApproval('a-6', true);
      await waiting;
      expect(resolveApproval('a-6', false)).toBe(false);
    });
  });
});

describe('planEdit', () => {
  describe('正常系', () => {
    it('1 か所だけ一致する文字列を置き換える', () => {
      expect(planEdit('a\nb\nc\n', 'b', 'B')).toEqual({
        ok: true,
        after: 'a\nB\nc\n',
      });
    });

    it('改行が CRLF の中身では、\\n で渡された文字列を \\r\\n に揃えて探して置き換える', () => {
      expect(planEdit('one\r\ntwo\r\nthree\r\n', 'one\ntwo', '1\n2')).toEqual({
        ok: true,
        after: '1\r\n2\r\nthree\r\n',
      });
    });
  });

  describe('準正常系', () => {
    it('置き換えた後の文字列の $& などを特別扱いしない', () => {
      expect(planEdit('price', 'price', '$& $1 $$')).toEqual({
        ok: true,
        after: '$& $1 $$',
      });
    });

    it('一致の数は重ならない一致を数える', () => {
      expect(countOccurrences('aaaa', 'aa')).toBe(2);
      expect(countOccurrences('abc', 'x')).toBe(0);
    });
  });

  describe('異常系', () => {
    it('0 か所・2 か所以上・前後が同じなら理由を返す', () => {
      expect(planEdit('abc', 'x', 'y')).toMatchObject({ ok: false });
      expect(planEdit('ab ab', 'ab', 'cd')).toEqual({
        ok: false,
        reason:
          'old_string がファイルの中に 2 か所あります。前後の行を足して、1 か所だけに一致するようにしてください',
      });
      expect(planEdit('abc', 'b', 'b')).toEqual({
        ok: false,
        reason: 'old_string と new_string が同じです',
      });
    });
  });
});

describe('buildPreview / describePreview', () => {
  describe('正常系', () => {
    it('unified diff と追加・削除の行数を作り、見出しにする', () => {
      const preview = buildPreview(
        'edit',
        '/r/README.md',
        'a\nb\nc\n',
        'a\nB\nc\nd\n'
      );
      expect(preview).toMatchObject({
        action: 'edit',
        path: '/r/README.md',
        added: 2,
        removed: 1,
      });
      expect(preview.diff).toContain('--- /r/README.md');
      expect(preview.diff).toContain('-b');
      expect(preview.diff).toContain('+B');
      expect(preview.diff).not.toContain('===');
      expect(describePreview(preview)).toBe('README.md を編集（+2 −1）');
    });
  });

  describe('準正常系', () => {
    it('新規作成は全部の行が追加になる', () => {
      const preview = buildPreview('create', '/r/new.txt', '', 'x\ny\n');
      expect(preview).toMatchObject({ added: 2, removed: 0 });
      expect(describePreview(preview)).toBe('new.txt を作成（+2 −0）');
    });
  });

  // 異常系: 引数はツールが確かめた中身だけで、不正な入力の経路が無い
});

describe('findUnwritableSegment', () => {
  describe('正常系', () => {
    it('.git の中は書かせない', () => {
      expect(findUnwritableSegment('/r/.git/hooks/pre-commit', '/r')).toBe(
        '.git'
      );
    });
  });

  describe('準正常系', () => {
    it('.git で始まるだけの名前（.gitignore・.github）は書ける', () => {
      expect(findUnwritableSegment('/r/.gitignore', '/r')).toBeNull();
      expect(
        findUnwritableSegment('/r/.github/workflows/ci.yml', '/r')
      ).toBeNull();
    });
  });

  // 異常系: パスは書き込み先の判定（resolveWritablePath）で実体のパスにした後だけで、不正な入力の経路が無い
});

describe('declinedOutput', () => {
  describe('正常系', () => {
    it('拒否は理由を聞くよう促し、時間切れは改めて確かめるよう促す', () => {
      expect(declinedOutput('rejected')).toMatchObject({
        isError: true,
        summary: '拒否されました',
      });
      expect(declinedOutput('expired')).toMatchObject({
        isError: true,
        summary: '承認されませんでした（時間切れ）',
      });
    });
  });

  // 準正常系・異常系: 引数は 2 つの値だけで、分かれ道は正常系で尽きる
});

describe('parseApprovalBody', () => {
  describe('正常系', () => {
    it('approved の真偽値を受け付ける', () => {
      expect(parseApprovalBody({ approved: true })).toEqual({
        ok: true,
        value: { approved: true },
      });
      expect(parseApprovalBody({ approved: false })).toEqual({
        ok: true,
        value: { approved: false },
      });
    });
  });

  describe('準正常系', () => {
    it('余分な項目は無視する', () => {
      expect(parseApprovalBody({ approved: true, extra: 1 })).toEqual({
        ok: true,
        value: { approved: true },
      });
    });
  });

  describe('異常系', () => {
    it('オブジェクトでない・approved が真偽値でなければ失敗', () => {
      expect(parseApprovalBody(null).ok).toBe(false);
      expect(parseApprovalBody({}).ok).toBe(false);
      expect(parseApprovalBody({ approved: 'true' }).ok).toBe(false);
    });
  });
});
