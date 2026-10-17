import { describe, it, expect } from 'vitest';
import {
  parseChatBody,
  parseCreateConversationBody,
  parseGenerateTitleBody,
  parseSaveMessageBody,
  readJsonBody,
} from '@/lib/request-body';
import {
  MAX_ASSISTANT_MESSAGE_LENGTH,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_LENGTH,
  MAX_SYSTEM_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
} from '@/lib/validation';

/**
 * `lib/request-body` の UT（#95）。
 * 各 route がボディを `unknown` で受けてここで検証する前提で、JSON としては正しいが
 * API の形に合わない値（`null`・配列・数値・型違いのフィールド）がすべて失敗になることを確かめる。
 * 純関数のため mock は使わない（`readJsonBody` は標準の `Request` を組んで渡すだけ）。
 */

/** JSON として正しいが、オブジェクトではないボディ。 */
const NON_OBJECT_BODIES: [string, unknown][] = [
  ['null', null],
  ['配列', []],
  ['数値', 123],
  ['文字列', 'hello'],
  ['真偽値', true],
];

/**
 * 本文付きの POST リクエストを組み立てる。
 *
 * @param body - リクエスト本文の文字列
 * @returns 標準の `Request`
 */
function postRequest(body: string): Request {
  return new Request('http://localhost/api/test', { method: 'POST', body });
}

/** 失敗した結果からエラーメッセージを取り出す（成功していたらテストを落とす）。 */
function errorOf(result: { ok: boolean; error?: string }): string {
  expect(result.ok).toBe(false);
  return result.error ?? '';
}

describe('readJsonBody', () => {
  describe('正常系', () => {
    it('JSON の本文を値として返す', async () => {
      expect(await readJsonBody(postRequest('{"a":1}'))).toEqual({
        ok: true,
        value: { a: 1 },
      });
    });

    it('JSON の null も構文としては正しいため、そのまま返す（形の検証は parse 側）', async () => {
      expect(await readJsonBody(postRequest('null'))).toEqual({
        ok: true,
        value: null,
      });
    });
  });

  describe('準正常系', () => {
    it('allowEmpty なら空の本文を {} として扱う', async () => {
      expect(await readJsonBody(postRequest(''), { allowEmpty: true })).toEqual(
        { ok: true, value: {} }
      );
    });
  });

  describe('異常系', () => {
    it('構文が不正な本文は失敗', async () => {
      expect(errorOf(await readJsonBody(postRequest('not-json')))).toBe(
        'リクエストボディのJSON形式が不正です'
      );
    });

    it('allowEmpty でなければ空の本文は失敗', async () => {
      expect((await readJsonBody(postRequest(''))).ok).toBe(false);
    });

    it('allowEmpty でも、中身があって構文が不正なら失敗', async () => {
      expect(
        (await readJsonBody(postRequest('{'), { allowEmpty: true })).ok
      ).toBe(false);
    });
  });
});

describe('parseChatBody', () => {
  describe('正常系', () => {
    it('全項目を指定したボディを検証済みの値にする', () => {
      expect(
        parseChatBody({
          message: '  やあ  ',
          conversationHistory: [
            { role: 'user', content: '前の質問' },
            { role: 'assistant', content: '前の回答' },
          ],
          model: 'qwen2.5:0.5b',
          enableTools: true,
          systemPrompt: 'あなたはリサーチャーです',
        })
      ).toEqual({
        ok: true,
        value: {
          message: 'やあ',
          conversationHistory: [
            { role: 'user', content: '前の質問' },
            { role: 'assistant', content: '前の回答' },
          ],
          model: 'qwen2.5:0.5b',
          enableTools: true,
          systemPrompt: 'あなたはリサーチャーです',
        },
      });
    });

    it('message だけなら履歴は空・enableTools は false になる', () => {
      expect(parseChatBody({ message: 'やあ' })).toEqual({
        ok: true,
        value: {
          message: 'やあ',
          conversationHistory: [],
          model: undefined,
          enableTools: false,
          systemPrompt: undefined,
        },
      });
    });
  });

  describe('準正常系', () => {
    it('任意フィールドの null は未指定として扱う', () => {
      const result = parseChatBody({
        message: 'やあ',
        conversationHistory: null,
        model: null,
        enableTools: null,
        systemPrompt: null,
      });
      expect(result).toEqual({
        ok: true,
        value: {
          message: 'やあ',
          conversationHistory: [],
          model: undefined,
          enableTools: false,
          systemPrompt: undefined,
        },
      });
    });

    it('履歴の要素は role と content だけに詰め直す（tool_calls などは Ollama へ渡さない）', () => {
      const result = parseChatBody({
        message: 'やあ',
        conversationHistory: [
          {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'x', arguments: {} } }],
          },
        ],
      });
      expect(result.ok && result.value.conversationHistory).toEqual([
        { role: 'assistant', content: '' },
      ]);
    });

    it('message・履歴件数・各 content・systemPrompt がちょうど上限なら通る（境界値）', () => {
      const result = parseChatBody({
        message: 'あ'.repeat(MAX_MESSAGE_LENGTH),
        conversationHistory: [
          { role: 'user', content: 'あ'.repeat(MAX_MESSAGE_LENGTH) },
          {
            role: 'assistant',
            content: 'あ'.repeat(MAX_ASSISTANT_MESSAGE_LENGTH),
          },
        ],
        systemPrompt: 'あ'.repeat(MAX_SYSTEM_PROMPT_LENGTH),
      });
      expect(result.ok).toBe(true);

      const history = Array.from({ length: MAX_HISTORY_MESSAGES }, () => ({
        role: 'user',
        content: 'x',
      }));
      expect(
        parseChatBody({ message: 'やあ', conversationHistory: history }).ok
      ).toBe(true);
    });
  });

  describe('異常系', () => {
    it.each(NON_OBJECT_BODIES)('ボディが%sなら失敗', (_label, body) => {
      expect(errorOf(parseChatBody(body))).toBe(
        'リクエストボディはJSONオブジェクトで指定してください'
      );
    });

    it.each([
      ['欠落', {}],
      ['空白のみ', { message: '   ' }],
      ['数値', { message: 123 }],
    ])('message が%sなら失敗', (_label, body) => {
      expect(errorOf(parseChatBody(body))).toBe('メッセージが空です');
    });

    it('message が上限を超えると失敗', () => {
      expect(
        errorOf(parseChatBody({ message: 'あ'.repeat(MAX_MESSAGE_LENGTH + 1) }))
      ).toBe('メッセージは10,000文字以内で入力してください');
    });

    it.each([
      ['model', { model: 1 }, 'modelは文字列で指定してください'],
      [
        'enableTools',
        { enableTools: 'true' },
        'enableToolsは真偽値で指定してください',
      ],
      [
        'systemPrompt',
        { systemPrompt: {} },
        'systemPromptは文字列で指定してください',
      ],
      [
        'conversationHistory',
        { conversationHistory: {} },
        'conversationHistoryは配列で指定してください',
      ],
    ])('%s の型が不正なら失敗', (_label, fields, expected) => {
      expect(errorOf(parseChatBody({ message: 'やあ', ...fields }))).toBe(
        expected
      );
    });

    it('systemPrompt が上限を超えると失敗', () => {
      expect(
        errorOf(
          parseChatBody({
            message: 'やあ',
            systemPrompt: 'あ'.repeat(MAX_SYSTEM_PROMPT_LENGTH + 1),
          })
        )
      ).toBe('systemPromptは10,000文字以内で指定してください');
    });

    it('履歴が件数上限を超えると失敗', () => {
      const history = Array.from({ length: MAX_HISTORY_MESSAGES + 1 }, () => ({
        role: 'user',
        content: 'x',
      }));
      expect(
        errorOf(
          parseChatBody({ message: 'やあ', conversationHistory: history })
        )
      ).toBe('conversationHistoryは1,000件以内で指定してください');
    });

    it.each([
      [
        '要素がオブジェクトでない',
        'こんにちは',
        'conversationHistory[1]はオブジェクトで指定してください',
      ],
      [
        'role が system',
        { role: 'system', content: '指示' },
        'conversationHistory[1].roleは "user" または "assistant" のみ有効です',
      ],
      [
        'role が tool',
        { role: 'tool', content: '結果' },
        'conversationHistory[1].roleは "user" または "assistant" のみ有効です',
      ],
      [
        'content が数値',
        { role: 'user', content: 1 },
        'conversationHistory[1].contentは文字列で指定してください',
      ],
      [
        'user の content が上限超過',
        { role: 'user', content: 'あ'.repeat(MAX_MESSAGE_LENGTH + 1) },
        'conversationHistory[1].contentは10,000文字以内で指定してください',
      ],
      [
        'assistant の content が上限超過',
        {
          role: 'assistant',
          content: 'あ'.repeat(MAX_ASSISTANT_MESSAGE_LENGTH + 1),
        },
        'conversationHistory[1].contentは100,000文字以内で指定してください',
      ],
    ])(
      '履歴の%sなら、何番目の要素かを示して失敗',
      (_label, entry, expected) => {
        expect(
          errorOf(
            parseChatBody({
              message: 'やあ',
              conversationHistory: [{ role: 'user', content: 'ok' }, entry],
            })
          )
        ).toBe(expected);
      }
    );
  });
});

describe('parseCreateConversationBody', () => {
  describe('正常系', () => {
    it('title の前後の空白を除いて返す', () => {
      expect(parseCreateConversationBody({ title: ' 会話 ' })).toEqual({
        ok: true,
        value: { title: '会話' },
      });
    });
  });

  describe('準正常系', () => {
    it.each([
      ['未指定', {}],
      ['null', { title: null }],
      ['空白のみ', { title: '   ' }],
    ])('title が%sなら既定タイトルになる', (_label, body) => {
      expect(parseCreateConversationBody(body)).toEqual({
        ok: true,
        value: { title: '新しい会話' },
      });
    });

    it('title がちょうど上限なら通る（境界値）', () => {
      expect(
        parseCreateConversationBody({ title: 'あ'.repeat(MAX_TITLE_LENGTH) }).ok
      ).toBe(true);
    });
  });

  describe('異常系', () => {
    it.each(NON_OBJECT_BODIES)('ボディが%sなら失敗', (_label, body) => {
      expect(parseCreateConversationBody(body).ok).toBe(false);
    });

    it('title が数値なら失敗', () => {
      expect(errorOf(parseCreateConversationBody({ title: 123 }))).toBe(
        'titleは文字列で指定してください'
      );
    });

    it('title が上限を超えると失敗', () => {
      expect(
        errorOf(
          parseCreateConversationBody({
            title: 'あ'.repeat(MAX_TITLE_LENGTH + 1),
          })
        )
      ).toBe('タイトルは100文字以内で入力してください');
    });
  });
});

describe('parseSaveMessageBody', () => {
  describe('正常系', () => {
    it('role・content・metadata を返す', () => {
      expect(
        parseSaveMessageBody({
          role: 'assistant',
          content: '回答',
          metadata: { agentRounds: 1 },
        })
      ).toEqual({
        ok: true,
        value: {
          role: 'assistant',
          content: '回答',
          metadata: { agentRounds: 1 },
        },
      });
    });
  });

  describe('準正常系', () => {
    it('metadata の null は未指定として扱う', () => {
      expect(
        parseSaveMessageBody({ role: 'user', content: 'やあ', metadata: null })
      ).toEqual({
        ok: true,
        value: { role: 'user', content: 'やあ', metadata: undefined },
      });
    });
  });

  describe('異常系', () => {
    it.each(NON_OBJECT_BODIES)('ボディが%sなら失敗', (_label, body) => {
      expect(parseSaveMessageBody(body).ok).toBe(false);
    });

    it.each([
      ['role 欠落', { content: 'やあ' }, 'roleとcontentは必須です'],
      [
        'content 空文字',
        { role: 'user', content: '' },
        'roleとcontentは必須です',
      ],
      [
        'role が system',
        { role: 'system', content: 'やあ' },
        'roleは "user" または "assistant" のみ有効です',
      ],
      [
        'role が数値',
        { role: 1, content: 'やあ' },
        'roleは "user" または "assistant" のみ有効です',
      ],
      [
        'content が数値',
        { role: 'user', content: 123 },
        'contentは文字列で指定してください',
      ],
      [
        'metadata が配列',
        { role: 'user', content: 'やあ', metadata: [] },
        'metadataはオブジェクト形式で指定してください',
      ],
    ])('%sなら失敗', (_label, body, expected) => {
      expect(errorOf(parseSaveMessageBody(body))).toBe(expected);
    });
  });
});

describe('parseGenerateTitleBody', () => {
  describe('正常系', () => {
    it('message と model を返す', () => {
      expect(parseGenerateTitleBody({ message: 'やあ', model: 'm' })).toEqual({
        ok: true,
        value: { message: 'やあ', model: 'm' },
      });
    });
  });

  describe('準正常系', () => {
    it('model の null は未指定として扱う', () => {
      expect(parseGenerateTitleBody({ message: 'やあ', model: null })).toEqual({
        ok: true,
        value: { message: 'やあ', model: undefined },
      });
    });
  });

  describe('異常系', () => {
    it.each(NON_OBJECT_BODIES)('ボディが%sなら失敗', (_label, body) => {
      expect(parseGenerateTitleBody(body).ok).toBe(false);
    });

    it('message が数値なら失敗', () => {
      expect(errorOf(parseGenerateTitleBody({ message: 1 }))).toBe(
        'メッセージが空です'
      );
    });

    it('model が数値なら失敗', () => {
      expect(
        errorOf(parseGenerateTitleBody({ message: 'やあ', model: 1 }))
      ).toBe('modelは文字列で指定してください');
    });
  });
});
