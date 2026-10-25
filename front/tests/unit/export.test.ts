import { describe, it, expect } from 'vitest';
import {
  buildConversationExport,
  buildExportFileName,
  buildMessageExport,
} from '@/lib/chat/export';
import type { Message } from '@/types/chat/message';
import type { Conversation } from '@/types/conversation/conversation';

/**
 * `lib/chat/export` の UT（#12）。応答・会話の書き出しのファイル名と中身の形を確かめる。
 *
 * 日時はローカル時刻で書くため、`new Date(年, 月, 日, 時, 分)`（ローカル時刻の指定）で作り、
 * 実行する環境のタイムゾーンに結果が左右されないようにする。純関数のため mock は使わない。
 */

/** 書き出した日時（2026-10-24 19:05、ローカル時刻） */
const EXPORTED_AT = new Date(2026, 9, 24, 19, 5);

/**
 * テスト用の会話を作る。
 *
 * @param overrides - 既定値から変える項目
 * @returns 会話
 */
function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    title: '旅行の計画',
    systemPrompt: null,
    createdAt: '2026-10-24T09:00:00.000Z',
    updatedAt: '2026-10-24T09:10:00.000Z',
    ...overrides,
  };
}

/**
 * テスト用のメッセージを作る。
 *
 * @param overrides - 既定値から変える項目
 * @returns メッセージ（既定は 2026-10-24 18:58 のユーザーの発話）
 */
function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    role: 'user',
    content: '京都の見どころは？',
    createdAt: new Date(2026, 9, 24, 18, 58),
    ...overrides,
  };
}

describe('buildExportFileName', () => {
  describe('正常系', () => {
    it('タイトル・ローカル時刻の日時・拡張子をつなぐ', () => {
      expect(buildExportFileName('旅行の計画', EXPORTED_AT, 'md')).toBe(
        '旅行の計画_2026-10-24_1905.md'
      );
    });

    it('月・日・時・分を 2 桁に揃える', () => {
      expect(
        buildExportFileName('メモ', new Date(2026, 0, 2, 3, 4), 'json')
      ).toBe('メモ_2026-01-02_0304.json');
    });
  });

  describe('準正常系', () => {
    it('空・空白だけのタイトルは「会話」にする', () => {
      expect(buildExportFileName('', EXPORTED_AT, 'md')).toBe(
        '会話_2026-10-24_1905.md'
      );
      expect(buildExportFileName('   ', EXPORTED_AT, 'md')).toBe(
        '会話_2026-10-24_1905.md'
      );
    });

    it('前後のピリオド・空白を除く（隠しファイル・Windows で消える末尾を避ける）', () => {
      expect(buildExportFileName(' ..メモ.. ', EXPORTED_AT, 'md')).toBe(
        'メモ_2026-10-24_1905.md'
      );
    });

    it('50 文字を超えるタイトルは 50 文字までに切り詰める', () => {
      const name = buildExportFileName('あ'.repeat(80), EXPORTED_AT, 'md');
      expect(name).toBe(`${'あ'.repeat(50)}_2026-10-24_1905.md`);
    });
  });

  describe('異常系', () => {
    it('ファイル名に使えない記号を _ に置き換える（パスの区切りでフォルダを作らせない）', () => {
      expect(
        buildExportFileName('a/b\\c:d*e?f"g<h>i|j', EXPORTED_AT, 'md')
      ).toBe('a_b_c_d_e_f_g_h_i_j_2026-10-24_1905.md');
      expect(buildExportFileName('../../etc', EXPORTED_AT, 'md')).toBe(
        '_.._etc_2026-10-24_1905.md'
      );
    });

    it('改行・タブ・制御文字を名前に残さない', () => {
      const name = buildExportFileName(
        '一行目\n二行目\tと\u0000終わり\u007f',
        EXPORTED_AT,
        'md'
      );
      expect(name).toBe('一行目_二行目_と_終わり__2026-10-24_1905.md');
      expect(name).not.toMatch(/[\u0000-\u001f\u007f]/);
    });

    it('切り詰めても絵文字（サロゲートペア）を途中で割らない', () => {
      const name = buildExportFileName('😀'.repeat(60), EXPORTED_AT, 'md');
      expect(name).toBe(`${'😀'.repeat(50)}_2026-10-24_1905.md`);
      expect(name.isWellFormed()).toBe(true);
    });
  });
});

describe('buildMessageExport', () => {
  describe('正常系', () => {
    it('応答の本文（Markdown の原文）をそのまま中身にし、応答の作成日時をファイル名に使う', () => {
      const content = '## 見どころ\n\n- 清水寺\n- `伏見稲荷`';
      const file = buildMessageExport(
        message({
          role: 'assistant',
          content,
          createdAt: new Date(2026, 9, 24, 18, 59),
        }),
        '旅行の計画'
      );
      expect(file).toEqual({
        fileName: '旅行の計画_2026-10-24_1859.md',
        content,
        mimeType: 'text/markdown;charset=utf-8',
      });
    });
  });

  describe('準正常系', () => {
    it('会話のタイトルが無い（一覧に載る前）ときは「会話」の名前にする', () => {
      expect(buildMessageExport(message(), '').fileName).toBe(
        '会話_2026-10-24_1858.md'
      );
    });
  });

  describe('異常系', () => {
    it('危ないタイトルでも、ファイル名に使えない文字を残さない', () => {
      expect(buildMessageExport(message(), 'x/../y').fileName).toBe(
        'x_.._y_2026-10-24_1858.md'
      );
    });
  });
});

describe('buildConversationExport（Markdown）', () => {
  const messages = [
    message(),
    message({
      id: 'm2',
      role: 'assistant',
      content: '清水寺がおすすめです。',
      createdAt: new Date(2026, 9, 24, 18, 59),
    }),
  ];

  describe('正常系', () => {
    it('見出し・書き出した日時と、ユーザー・アシスタントを --- 区切りで交互に並べる', () => {
      const file = buildConversationExport(
        conversation(),
        messages,
        'markdown',
        EXPORTED_AT
      );
      expect(file.fileName).toBe('旅行の計画_2026-10-24_1905.md');
      expect(file.mimeType).toBe('text/markdown;charset=utf-8');
      expect(file.content).toBe(
        [
          '# 旅行の計画',
          '',
          '- 書き出した日時: 2026-10-24 19:05',
          '',
          '---',
          '',
          '## ユーザー（2026-10-24 18:58）',
          '',
          '京都の見どころは？',
          '',
          '---',
          '',
          '## アシスタント（2026-10-24 18:59）',
          '',
          '清水寺がおすすめです。',
          '',
        ].join('\n')
      );
    });

    it('会話の役割があれば、表示名と本文（引用）を書く', () => {
      const prompt =
        'あなたは優秀な翻訳者です。日本語の文は英語に、英語の文は日本語に、自然な表現で翻訳してください。訳文だけを返し、補足が必要な場合は訳文の後に短く添えてください。';
      const { content } = buildConversationExport(
        conversation({ systemPrompt: prompt }),
        messages,
        'markdown',
        EXPORTED_AT
      );
      expect(content).toContain(`- 会話の役割: 翻訳者\n\n> ${prompt}\n\n---`);
    });
  });

  describe('準正常系', () => {
    it('自由入力の複数行の役割は「カスタム」とし、各行を引用にする（空行も引用を切らない）', () => {
      const { content } = buildConversationExport(
        conversation({ systemPrompt: '一行目\n\n三行目' }),
        messages,
        'markdown',
        EXPORTED_AT
      );
      expect(content).toContain(
        '- 会話の役割: カスタム\n\n> 一行目\n>\n> 三行目\n'
      );
    });

    it('空白だけの役割は書かない', () => {
      const { content } = buildConversationExport(
        conversation({ systemPrompt: '  ' }),
        messages,
        'markdown',
        EXPORTED_AT
      );
      expect(content).not.toContain('会話の役割');
    });

    it('中断した応答には、中断した旨を添える', () => {
      const { content } = buildConversationExport(
        conversation(),
        [
          message({
            role: 'assistant',
            content: '途中まで',
            metadata: { interrupted: true },
          }),
        ],
        'markdown',
        EXPORTED_AT
      );
      expect(content).toContain('途中まで\n\n_（生成を中断した応答）_\n');
    });

    it('思考過程・ツールの結果は入れない', () => {
      const { content } = buildConversationExport(
        conversation(),
        [
          message({
            role: 'assistant',
            content: '答え',
            metadata: {
              thinkingText: '考えた過程',
              toolCalls: [
                {
                  name: 'calculate',
                  arguments: { expression: '1+1' },
                  result: '2',
                  isError: false,
                  durationMs: 3,
                },
              ],
            },
          }),
        ],
        'markdown',
        EXPORTED_AT
      );
      expect(content).not.toContain('考えた過程');
      expect(content).not.toContain('calculate');
    });

    it('メッセージが無くても、見出しだけの Markdown を返す', () => {
      const { content } = buildConversationExport(
        conversation(),
        [],
        'markdown',
        EXPORTED_AT
      );
      expect(content).toBe(
        '# 旅行の計画\n\n- 書き出した日時: 2026-10-24 19:05\n'
      );
    });
  });

  describe('異常系', () => {
    it('改行を含むタイトルでも見出しを 1 行に保つ', () => {
      const { content } = buildConversationExport(
        conversation({ title: '一行目\n# 二行目' }),
        messages,
        'markdown',
        EXPORTED_AT
      );
      expect(content.split('\n')[0]).toBe('# 一行目 # 二行目');
    });

    it('本文に見出しや --- があっても、そのまま書く（原文を変えない）', () => {
      const body = '## 見出し\n\n---\n\n本文';
      const { content } = buildConversationExport(
        conversation(),
        [message({ role: 'assistant', content: body })],
        'markdown',
        EXPORTED_AT
      );
      expect(content).toContain(`（2026-10-24 18:58）\n\n${body}\n`);
    });
  });
});

describe('buildConversationExport（JSON）', () => {
  describe('正常系', () => {
    it('版・書き出した日時・会話・メッセージ（metadata を含む）を省かずに出す', () => {
      const conv = conversation({ systemPrompt: '役割' });
      const metadata = { thinkingText: '過程', agentRounds: 2 };
      const createdAt = new Date(2026, 9, 24, 18, 59);
      const file = buildConversationExport(
        conv,
        [
          message(),
          message({
            id: 'm2',
            role: 'assistant',
            content: '答え',
            createdAt,
            metadata,
          }),
        ],
        'json',
        EXPORTED_AT
      );
      expect(file.fileName).toBe('旅行の計画_2026-10-24_1905.json');
      expect(file.mimeType).toBe('application/json;charset=utf-8');
      expect(JSON.parse(file.content)).toEqual({
        version: 1,
        exportedAt: EXPORTED_AT.toISOString(),
        conversation: conv,
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: '京都の見どころは？',
            createdAt: new Date(2026, 9, 24, 18, 58).toISOString(),
            metadata: null,
          },
          {
            id: 'm2',
            role: 'assistant',
            content: '答え',
            createdAt: createdAt.toISOString(),
            metadata,
          },
        ],
      });
    });

    it('人が読めるように字下げし、末尾を改行で終える', () => {
      const { content } = buildConversationExport(
        conversation(),
        [],
        'json',
        EXPORTED_AT
      );
      expect(content.startsWith('{\n  "version": 1,')).toBe(true);
      expect(content.endsWith('}\n')).toBe(true);
    });
  });

  describe('準正常系', () => {
    it('画面の側だけの保存失敗の状態（saveState）は入れない', () => {
      const { content } = buildConversationExport(
        conversation(),
        [message({ saveState: 'failed' })],
        'json',
        EXPORTED_AT
      );
      expect(JSON.parse(content).messages[0]).not.toHaveProperty('saveState');
    });
  });

  describe('異常系', () => {
    it('本文の引用符・改行・制御文字を壊さずに往復できる', () => {
      const tricky = '"引用" と \\ と\n改行と\u0000';
      const { content } = buildConversationExport(
        conversation({ title: tricky }),
        [message({ content: tricky })],
        'json',
        EXPORTED_AT
      );
      const parsed = JSON.parse(content);
      expect(parsed.conversation.title).toBe(tricky);
      expect(parsed.messages[0].content).toBe(tricky);
    });
  });
});
