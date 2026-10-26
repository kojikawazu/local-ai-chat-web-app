import { describe, it, expect } from 'vitest';
import {
  parseChatBody,
  parseCreateConversationBody,
  parseGenerateTitleBody,
  parsePlantUmlBody,
  parseReplaceMessageBody,
  parseSaveMessageBody,
  parseUpdateConversationBody,
  readJsonBody,
} from '@/lib/server/request-body';
import {
  MAX_ASSISTANT_MESSAGE_LENGTH,
  MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH,
  MAX_DIAGRAM_SOURCE_LENGTH,
  MAX_HISTORY_MESSAGES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LONG_EDGE,
  MAX_IMAGES_PER_MESSAGE,
  MAX_MESSAGE_LENGTH,
  MAX_SYSTEM_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
} from '@/lib/shared/validation';

/**
 * `lib/server/request-body` の UT（#95）。
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

/**
 * 先頭だけが PNG のシグネチャのバイト列を Base64 にする。
 * サーバーは先頭のバイトで形式を判定するだけ（画像として描けるかは確かめない）ため、これで足りる。
 */
const PNG_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]).toString('base64');
/** 先頭だけが JPEG の SOI マーカーのバイト列の Base64。 */
const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString(
  'base64'
);
/** GIF（受け付けない形式）の先頭のバイト列の Base64。 */
const GIF_BASE64 = Buffer.from('GIF89a').toString('base64');

/**
 * 保存 API の添付 1 枚を組み立てる。
 *
 * @param fields - 上書きする項目
 * @returns `{ id, data, width, height }` の添付
 */
function attachment(fields: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    data: PNG_BASE64,
    width: 640,
    height: 480,
    ...fields,
  };
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
          imageIds: [],
          conversationHistory: [
            { role: 'user', content: '前の質問', imageIds: [] },
            { role: 'assistant', content: '前の回答', imageIds: [] },
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
          imageIds: [],
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
          imageIds: [],
          conversationHistory: [],
          model: undefined,
          enableTools: false,
          systemPrompt: undefined,
        },
      });
    });

    it('履歴の要素は role・content・imageIds だけに詰め直す（tool_calls などは Ollama へ渡さない）', () => {
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
        { role: 'assistant', content: '', imageIds: [] },
      ]);
    });

    it('imageIds（送信する質問・履歴の user）を返す（#6）', () => {
      const current = crypto.randomUUID();
      const past = crypto.randomUUID();
      const result = parseChatBody({
        message: 'これは？',
        imageIds: [current],
        conversationHistory: [
          { role: 'user', content: '前の質問', imageIds: [past] },
        ],
      });
      expect(result.ok && result.value.imageIds).toEqual([current]);
      expect(result.ok && result.value.conversationHistory[0].imageIds).toEqual(
        [past]
      );
    });

    it('imageIds がちょうど上限の枚数なら通る（境界値）', () => {
      const imageIds = Array.from({ length: MAX_IMAGES_PER_MESSAGE }, () =>
        crypto.randomUUID()
      );
      expect(parseChatBody({ message: 'やあ', imageIds }).ok).toBe(true);
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
      ['imageIds', { imageIds: 'id' }, 'imageIdsは配列で指定してください'],
    ])('%s の型が不正なら失敗', (_label, fields, expected) => {
      expect(errorOf(parseChatBody({ message: 'やあ', ...fields }))).toBe(
        expected
      );
    });

    it.each([
      [
        '上限の枚数を超える',
        Array.from({ length: MAX_IMAGES_PER_MESSAGE + 1 }, () =>
          crypto.randomUUID()
        ),
        '画像は1メッセージにつき4枚までです',
      ],
      [
        'UUID 形式でない',
        ['not-a-uuid'],
        'imageIdsの要素はUUID形式で指定してください',
      ],
      ['数値を含む', [1], 'imageIdsの要素はUUID形式で指定してください'],
      [
        '同じ ID を含む',
        [
          '00000000-0000-4000-8000-000000000000',
          '00000000-0000-4000-8000-000000000000',
        ],
        'imageIdsに同じIDが含まれています',
      ],
    ])('imageIds が%sなら失敗', (_label, imageIds, expected) => {
      expect(errorOf(parseChatBody({ message: 'やあ', imageIds }))).toBe(
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
      [
        'imageIds が UUID 形式でない',
        { role: 'user', content: 'ok', imageIds: ['x'] },
        'conversationHistory[1].imageIdsの要素はUUID形式で指定してください',
      ],
      [
        'assistant に imageIds がある',
        {
          role: 'assistant',
          content: 'ok',
          imageIds: ['00000000-0000-4000-8000-000000000000'],
        },
        'conversationHistory[1].imageIdsはuserのメッセージにだけ指定できます',
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
        value: { title: '会話', systemPrompt: null },
      });
    });

    it('systemPrompt（会話の役割）の前後の空白を除いて返す（#10）', () => {
      expect(
        parseCreateConversationBody({ title: '会話', systemPrompt: ' 翻訳者 ' })
      ).toEqual({
        ok: true,
        value: { title: '会話', systemPrompt: '翻訳者' },
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
        value: { title: '新しい会話', systemPrompt: null },
      });
    });

    it.each([
      ['null', null],
      ['空白のみ', '   '],
    ])('systemPrompt が%sなら役割なし（null）', (_label, systemPrompt) => {
      expect(parseCreateConversationBody({ systemPrompt })).toEqual({
        ok: true,
        value: { title: '新しい会話', systemPrompt: null },
      });
    });

    it('systemPrompt がちょうど上限なら通る（境界値）', () => {
      expect(
        parseCreateConversationBody({
          systemPrompt: 'あ'.repeat(MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH),
        }).ok
      ).toBe(true);
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

    it('systemPrompt が文字列でなければ失敗', () => {
      expect(errorOf(parseCreateConversationBody({ systemPrompt: 1 }))).toBe(
        'systemPromptは文字列で指定してください'
      );
    });

    it('systemPrompt が上限を超えると失敗', () => {
      expect(
        errorOf(
          parseCreateConversationBody({
            systemPrompt: 'あ'.repeat(
              MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH + 1
            ),
          })
        )
      ).toBe('systemPromptは5,000文字以内で指定してください');
    });
  });
});

describe('parseUpdateConversationBody', () => {
  describe('正常系', () => {
    it('systemPrompt の前後の空白を除いて返す', () => {
      expect(parseUpdateConversationBody({ systemPrompt: ' 翻訳者 ' })).toEqual(
        { ok: true, value: { systemPrompt: '翻訳者' } }
      );
    });
  });

  describe('準正常系', () => {
    it.each([
      ['null', null],
      ['空文字', ''],
      ['空白のみ', ' \n '],
    ])('systemPrompt が%sなら役割を外す（null）', (_label, systemPrompt) => {
      expect(parseUpdateConversationBody({ systemPrompt })).toEqual({
        ok: true,
        value: { systemPrompt: null },
      });
    });

    it('systemPrompt 以外のフィールドは無視する（役割だけを変更できる）', () => {
      expect(
        parseUpdateConversationBody({ systemPrompt: '役割', title: '変更' })
      ).toEqual({ ok: true, value: { systemPrompt: '役割' } });
    });
  });

  describe('異常系', () => {
    it.each(NON_OBJECT_BODIES)('ボディが%sなら失敗', (_label, body) => {
      expect(parseUpdateConversationBody(body).ok).toBe(false);
    });

    it('systemPrompt キーが無ければ失敗（変えないのか外すのか区別できないため）', () => {
      expect(errorOf(parseUpdateConversationBody({}))).toBe(
        'systemPromptを指定してください（外す場合は null）'
      );
    });

    it('systemPrompt が文字列でも null でもなければ失敗', () => {
      expect(
        errorOf(parseUpdateConversationBody({ systemPrompt: ['役割'] }))
      ).toBe('systemPromptは文字列で指定してください');
    });

    it('systemPrompt が上限を超えると失敗', () => {
      expect(
        parseUpdateConversationBody({
          systemPrompt: 'あ'.repeat(MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH + 1),
        }).ok
      ).toBe(false);
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
          id: undefined,
          role: 'assistant',
          content: '回答',
          metadata: { agentRounds: 1 },
          attachments: [],
        },
      });
    });

    it('attachments の Base64 を復号し、形式を中身から判定して返す（#6）', () => {
      const png = attachment();
      const jpeg = attachment({ data: JPEG_BASE64, width: 1, height: 1 });
      const result = parseSaveMessageBody({
        role: 'user',
        content: 'これは？',
        attachments: [png, jpeg],
      });
      expect(result.ok).toBe(true);
      const attachments = result.ok ? result.value.attachments : [];
      expect(
        attachments.map((a) => [a.id, a.mimeType, a.width, a.height])
      ).toEqual([
        [png.id, 'image/png', 640, 480],
        [jpeg.id, 'image/jpeg', 1, 1],
      ]);
      expect(Buffer.from(attachments[0].data).toString('base64')).toBe(
        PNG_BASE64
      );
    });

    it('クライアントが採番した id（UUID）を返す（#9）', () => {
      const id = crypto.randomUUID();
      const result = parseSaveMessageBody({
        id,
        role: 'user',
        content: 'やあ',
      });
      expect(result.ok && result.value.id).toBe(id);
    });
  });

  describe('準正常系', () => {
    it('id の null は未指定として扱う（DB が採番する）', () => {
      const result = parseSaveMessageBody({
        id: null,
        role: 'user',
        content: 'やあ',
      });
      expect(result.ok && result.value.id).toBeUndefined();
    });

    it('metadata の null は未指定として扱う', () => {
      expect(
        parseSaveMessageBody({ role: 'user', content: 'やあ', metadata: null })
      ).toEqual({
        ok: true,
        value: {
          id: undefined,
          role: 'user',
          content: 'やあ',
          metadata: undefined,
          attachments: [],
        },
      });
    });

    it('attachments の null は添付なしとして扱う', () => {
      const result = parseSaveMessageBody({
        role: 'user',
        content: 'やあ',
        attachments: null,
      });
      expect(result.ok && result.value.attachments).toEqual([]);
    });

    it('attachments の枚数・寸法・バイト数がちょうど上限なら通る（境界値）', () => {
      // 先頭を PNG のシグネチャにした、ちょうど上限のバイト数の画像
      const bytes = new Uint8Array(MAX_IMAGE_BYTES);
      bytes.set(Buffer.from(PNG_BASE64, 'base64'));
      const largest = attachment({
        data: Buffer.from(bytes).toString('base64'),
        width: MAX_IMAGE_LONG_EDGE,
        height: MAX_IMAGE_LONG_EDGE,
      });
      const attachments = [
        largest,
        ...Array.from({ length: MAX_IMAGES_PER_MESSAGE - 1 }, () =>
          attachment()
        ),
      ];
      expect(
        parseSaveMessageBody({ role: 'user', content: 'やあ', attachments }).ok
      ).toBe(true);
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
      [
        'id が UUID 形式でない',
        { id: 'not-a-uuid', role: 'user', content: 'やあ' },
        'idはUUID形式で指定してください',
      ],
      [
        'id が数値',
        { id: 1, role: 'user', content: 'やあ' },
        'idはUUID形式で指定してください',
      ],
    ])('%sなら失敗', (_label, body, expected) => {
      expect(errorOf(parseSaveMessageBody(body))).toBe(expected);
    });

    it('assistant に attachments があれば失敗（添付は user だけが持つ）', () => {
      expect(
        errorOf(
          parseSaveMessageBody({
            role: 'assistant',
            content: '回答',
            attachments: [attachment()],
          })
        )
      ).toBe('attachmentsはuserのメッセージにだけ指定できます');
    });

    it('attachments が上限の枚数を超えると失敗', () => {
      const attachments = Array.from(
        { length: MAX_IMAGES_PER_MESSAGE + 1 },
        () => attachment()
      );
      expect(
        errorOf(
          parseSaveMessageBody({ role: 'user', content: 'やあ', attachments })
        )
      ).toBe('画像は1メッセージにつき4枚までです');
    });

    it('同じ ID の添付を含むと失敗', () => {
      const first = attachment();
      expect(
        errorOf(
          parseSaveMessageBody({
            role: 'user',
            content: 'やあ',
            attachments: [first, attachment({ id: first.id })],
          })
        )
      ).toBe('attachmentsに同じIDが含まれています');
    });

    it('1 枚のバイト数が上限を超えると、復号せずに失敗', () => {
      const bytes = new Uint8Array(MAX_IMAGE_BYTES + 1);
      bytes.set(Buffer.from(PNG_BASE64, 'base64'));
      expect(
        errorOf(
          parseSaveMessageBody({
            role: 'user',
            content: 'やあ',
            attachments: [
              attachment({ data: Buffer.from(bytes).toString('base64') }),
            ],
          })
        )
      ).toBe('画像は1枚5MB以内にしてください');
    });

    it.each([
      ['配列でない', {}, 'attachmentsは配列で指定してください'],
      [
        '要素がオブジェクトでない',
        ['x'],
        'attachments[0]はオブジェクトで指定してください',
      ],
      [
        'id が UUID 形式でない',
        [attachment({ id: 'x' })],
        'attachments[0].idはUUID形式で指定してください',
      ],
      [
        'width が 0',
        [attachment({ width: 0 })],
        `attachments[0]のwidth・heightは1〜${MAX_IMAGE_LONG_EDGE}の整数で指定してください`,
      ],
      [
        'height が上限を超える',
        [attachment({ height: MAX_IMAGE_LONG_EDGE + 1 })],
        `attachments[0]のwidth・heightは1〜${MAX_IMAGE_LONG_EDGE}の整数で指定してください`,
      ],
      [
        'width が小数',
        [attachment({ width: 1.5 })],
        `attachments[0]のwidth・heightは1〜${MAX_IMAGE_LONG_EDGE}の整数で指定してください`,
      ],
      [
        'data が数値',
        [attachment({ data: 1 })],
        'attachments[0].dataは文字列で指定してください',
      ],
      [
        'data が Base64 でない',
        [attachment({ data: 'not base64!' })],
        'attachments[0].dataはBase64で指定してください',
      ],
      [
        'data が data: URI',
        [attachment({ data: `data:image/png;base64,${PNG_BASE64}` })],
        'attachments[0].dataはBase64で指定してください',
      ],
      [
        'data が GIF',
        [attachment({ data: GIF_BASE64 })],
        '画像はPNGかJPEGで指定してください',
      ],
      [
        'data が SVG（スクリプトを含みうる）',
        [attachment({ data: Buffer.from('<svg></svg>').toString('base64') })],
        '画像はPNGかJPEGで指定してください',
      ],
    ])('attachments の%sなら失敗', (_label, attachments, expected) => {
      expect(
        errorOf(
          parseSaveMessageBody({ role: 'user', content: 'やあ', attachments })
        )
      ).toBe(expected);
    });
  });
});

describe('parseReplaceMessageBody', () => {
  describe('正常系', () => {
    it('content と metadata を返す', () => {
      expect(
        parseReplaceMessageBody({
          content: '新しい回答',
          metadata: { agentRounds: 2 },
        })
      ).toEqual({
        ok: true,
        value: { content: '新しい回答', metadata: { agentRounds: 2 } },
      });
    });
  });

  describe('準正常系', () => {
    it('metadata の null は未指定として扱う（旧応答の metadata を消す）', () => {
      expect(parseReplaceMessageBody({ content: 'x', metadata: null })).toEqual(
        { ok: true, value: { content: 'x', metadata: undefined } }
      );
    });

    it('role を付けても無視する（置き換えられるのは assistant だけ）', () => {
      expect(parseReplaceMessageBody({ role: 'user', content: 'x' })).toEqual({
        ok: true,
        value: { content: 'x', metadata: undefined },
      });
    });

    it('assistant の上限ちょうどの本文は通す（境界値。user の上限ではない）', () => {
      const content = 'あ'.repeat(MAX_ASSISTANT_MESSAGE_LENGTH);
      expect(parseReplaceMessageBody({ content }).ok).toBe(true);
    });
  });

  describe('異常系', () => {
    it.each(NON_OBJECT_BODIES)('ボディが%sなら失敗', (_label, body) => {
      expect(parseReplaceMessageBody(body).ok).toBe(false);
    });

    it.each([
      ['content 欠落', {}, 'contentは空でない文字列で指定してください'],
      [
        'content 空文字',
        { content: '' },
        'contentは空でない文字列で指定してください',
      ],
      [
        'content が数値',
        { content: 1 },
        'contentは空でない文字列で指定してください',
      ],
      [
        'metadata が配列',
        { content: 'x', metadata: [] },
        'metadataはオブジェクト形式で指定してください',
      ],
      [
        'content が assistant の上限を超える',
        { content: 'あ'.repeat(MAX_ASSISTANT_MESSAGE_LENGTH + 1) },
        'メッセージは100,000文字以内で入力してください',
      ],
    ])('%sなら失敗', (_label, body, expected) => {
      expect(errorOf(parseReplaceMessageBody(body))).toBe(expected);
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

describe('parsePlantUmlBody', () => {
  describe('正常系', () => {
    it('ソースを前後の空白・改行を含めて書かれたまま返す', () => {
      const source = '\n@startuml\nA -> B\n@enduml\n';
      expect(parsePlantUmlBody({ source })).toEqual({
        ok: true,
        value: { source },
      });
    });
  });

  describe('準正常系', () => {
    it('上限ちょうどの長さは受け付ける', () => {
      const source = 'a'.repeat(MAX_DIAGRAM_SOURCE_LENGTH);
      expect(parsePlantUmlBody({ source }).ok).toBe(true);
    });

    it('上限を 1 文字でも超えると失敗', () => {
      const source = 'a'.repeat(MAX_DIAGRAM_SOURCE_LENGTH + 1);
      expect(errorOf(parsePlantUmlBody({ source }))).toBe(
        '図のソースは50,000文字以内で指定してください'
      );
    });

    it('空白・改行だけのソースは失敗', () => {
      expect(errorOf(parsePlantUmlBody({ source: ' \n\t ' }))).toBe(
        '図のソースが空です'
      );
    });
  });

  describe('異常系', () => {
    it.each(NON_OBJECT_BODIES)('ボディが%sなら失敗', (_label, body) => {
      expect(parsePlantUmlBody(body).ok).toBe(false);
    });

    it.each([
      ['未指定', {}],
      ['null', { source: null }],
      ['数値', { source: 1 }],
      ['配列', { source: ['A -> B'] }],
    ])('source が%sなら失敗', (_label, body) => {
      expect(errorOf(parsePlantUmlBody(body))).toBe(
        'sourceは文字列で指定してください'
      );
    });
  });
});
