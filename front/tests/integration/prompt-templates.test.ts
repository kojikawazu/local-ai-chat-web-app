import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET, POST } from '@/app/api/prompt-templates/route';
import { PUT, DELETE } from '@/app/api/prompt-templates/[id]/route';
import { POST as POST_EXAMPLES } from '@/app/api/prompt-templates/examples/route';
import { prisma, resetDb, jsonRequest, routeContext } from './helpers/db';
import { MAX_PROMPT_TEMPLATES } from '@/lib/shared/validation';

/**
 * `/api/prompt-templates`（プロンプトテンプレートの CRUD と例の作成。#28）の IT。
 * 一覧の順・作成・置き換え・削除・重複の 409・404・400・件数の上限・例の作成を実 DB に対して検証する。
 */
const URL = 'http://localhost/api/prompt-templates';
const NONEXISTENT = '00000000-0000-0000-0000-000000000000';
const DUPLICATE_ERROR = 'そのショートカットは既に使われています';

/**
 * テンプレートを DB に直接作る（API の検証を通さない前提の用意）。
 *
 * @param shortcut - ショートカット
 * @param name - 名前（省略時はショートカットと同じ）
 * @returns 作成したテンプレート
 */
async function createTemplate(shortcut: string, name = shortcut) {
  return prisma.promptTemplate.create({
    data: { shortcut, name, content: `${name}の本文\n` },
  });
}

/**
 * 指定したテーブルの、指定した操作だけを実 DB 側で失敗させて `run` を実行する（Prisma をモックしない障害注入）。
 *
 * @param operation - 失敗させる操作（`INSERT` / `UPDATE` / `DELETE`）
 * @param run - 失敗させている間に行う処理
 */
async function withFailingTemplates(
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  run: () => Promise<void>
) {
  await prisma.$executeRaw`
    CREATE FUNCTION fail_prompt_template() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected failure';
    END;
    $$ LANGUAGE plpgsql`;
  // 操作の種類は SQL の識別子の位置でパラメータにできないため、文字列を組み立てずに操作ごとの固定の文を書く
  if (operation === 'INSERT') {
    await prisma.$executeRaw`CREATE TRIGGER fail_prompt_template BEFORE INSERT ON "PromptTemplate" FOR EACH ROW EXECUTE FUNCTION fail_prompt_template()`;
  } else if (operation === 'UPDATE') {
    await prisma.$executeRaw`CREATE TRIGGER fail_prompt_template BEFORE UPDATE ON "PromptTemplate" FOR EACH ROW EXECUTE FUNCTION fail_prompt_template()`;
  } else {
    await prisma.$executeRaw`CREATE TRIGGER fail_prompt_template BEFORE DELETE ON "PromptTemplate" FOR EACH ROW EXECUTE FUNCTION fail_prompt_template()`;
  }
  try {
    await run();
  } finally {
    await prisma.$executeRaw`DROP TRIGGER fail_prompt_template ON "PromptTemplate"`;
    await prisma.$executeRaw`DROP FUNCTION fail_prompt_template()`;
  }
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET・POST /api/prompt-templates', () => {
  describe('正常系', () => {
    it('一覧をショートカットの昇順で返す', async () => {
      await createTemplate('translate');
      await createTemplate('review');
      await createTemplate('summarize');

      const res = await GET();
      expect(res.status).toBe(200);
      const { templates } = await res.json();
      expect(templates.map((t: { shortcut: string }) => t.shortcut)).toEqual([
        'review',
        'summarize',
        'translate',
      ]);
      expect(Object.keys(templates[0]).sort()).toEqual([
        'content',
        'createdAt',
        'id',
        'name',
        'shortcut',
        'updatedAt',
      ]);
    });

    it('作成して 201 を返す（名前の空白を除き、ショートカットを小文字にし、本文の改行は残す）', async () => {
      const res = await POST(
        jsonRequest(URL, 'POST', {
          name: ' 英語に翻訳 ',
          shortcut: 'Translate',
          content: '以下を英語に翻訳してください。\n\n',
        })
      );
      expect(res.status).toBe(201);
      const created = await res.json();
      expect(created).toMatchObject({
        name: '英語に翻訳',
        shortcut: 'translate',
        content: '以下を英語に翻訳してください。\n\n',
      });
      const saved = await prisma.promptTemplate.findUnique({
        where: { id: created.id },
      });
      expect(saved?.content).toBe('以下を英語に翻訳してください。\n\n');
    });

    it('一覧が空なら空配列', async () => {
      const res = await GET();
      expect(await res.json()).toEqual({ templates: [] });
    });
  });

  describe('準正常系', () => {
    it('ショートカットが重複すると 409 で、作らない（大文字で送っても重複）', async () => {
      await createTemplate('translate');
      const res = await POST(
        jsonRequest(URL, 'POST', {
          name: '別の翻訳',
          shortcut: 'TRANSLATE',
          content: '本文',
        })
      );
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: DUPLICATE_ERROR });
      expect(await prisma.promptTemplate.count()).toBe(1);
    });

    it(`${MAX_PROMPT_TEMPLATES} 件あると 400 で、作らない`, async () => {
      await prisma.promptTemplate.createMany({
        data: Array.from({ length: MAX_PROMPT_TEMPLATES }, (_, i) => ({
          shortcut: `t${i}`,
          name: `t${i}`,
          content: '本文',
        })),
      });
      const res = await POST(
        jsonRequest(URL, 'POST', {
          name: '新',
          shortcut: 'new',
          content: '本文',
        })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        `テンプレートは${MAX_PROMPT_TEMPLATES}件まで保存できます`
      );
      expect(await prisma.promptTemplate.count()).toBe(MAX_PROMPT_TEMPLATES);
    });

    it('ショートカットの形が不正なら 400 で、作らない', async () => {
      const res = await POST(
        jsonRequest(URL, 'POST', {
          name: '翻訳',
          shortcut: '翻訳',
          content: '本文',
        })
      );
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe('string');
      expect(await prisma.promptTemplate.count()).toBe(0);
    });
  });

  describe('異常系', () => {
    it('JSON として不正なボディは 400', async () => {
      const res = await POST(jsonRequest(URL, 'POST', '{not json'));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'リクエストボディのJSON形式が不正です',
      });
    });

    it('DB 側で作成に失敗すると 500', async () => {
      await withFailingTemplates('INSERT', async () => {
        const res = await POST(
          jsonRequest(URL, 'POST', {
            name: '翻訳',
            shortcut: 'tr',
            content: '本文',
          })
        );
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
          error: 'テンプレートの作成に失敗しました',
        });
      });
      expect(await prisma.promptTemplate.count()).toBe(0);
    });
  });
});

describe('PUT・DELETE /api/prompt-templates/[id]', () => {
  describe('正常系', () => {
    it('置き換えて、置き換えたテンプレートを返す', async () => {
      const target = await createTemplate('translate', '英語に翻訳');
      const res = await PUT(
        jsonRequest(`${URL}/x`, 'PUT', {
          name: '英訳',
          shortcut: 'en',
          content: '英訳してください。',
        }),
        routeContext(target.id)
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        id: target.id,
        name: '英訳',
        shortcut: 'en',
        content: '英訳してください。',
      });
    });

    it('ショートカットを変えない置き換えは重複にならない', async () => {
      const target = await createTemplate('translate');
      const res = await PUT(
        jsonRequest(`${URL}/x`, 'PUT', {
          name: '名前だけ変える',
          shortcut: 'translate',
          content: '本文',
        }),
        routeContext(target.id)
      );
      expect(res.status).toBe(200);
    });

    it('削除する', async () => {
      const target = await createTemplate('translate');
      const res = await DELETE(
        jsonRequest(`${URL}/x`, 'DELETE'),
        routeContext(target.id)
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(await prisma.promptTemplate.count()).toBe(0);
    });
  });

  describe('準正常系', () => {
    it('別のテンプレートのショートカットに置き換えると 409 で、変えない', async () => {
      await createTemplate('review');
      const target = await createTemplate('translate');
      const res = await PUT(
        jsonRequest(`${URL}/x`, 'PUT', {
          name: 'x',
          shortcut: 'review',
          content: '本文',
        }),
        routeContext(target.id)
      );
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: DUPLICATE_ERROR });
      expect(
        (await prisma.promptTemplate.findUnique({ where: { id: target.id } }))
          ?.shortcut
      ).toBe('translate');
    });

    it('存在しないテンプレートの置き換え・削除は 404', async () => {
      const put = await PUT(
        jsonRequest(`${URL}/x`, 'PUT', {
          name: 'x',
          shortcut: 'x',
          content: 'x',
        }),
        routeContext(NONEXISTENT)
      );
      expect(put.status).toBe(404);
      expect(await put.json()).toEqual({
        error: 'テンプレートが見つかりません',
      });

      const del = await DELETE(
        jsonRequest(`${URL}/x`, 'DELETE'),
        routeContext(NONEXISTENT)
      );
      expect(del.status).toBe(404);
    });

    it('ボディが不正なら、ID が存在しても 400 で変えない', async () => {
      const target = await createTemplate('translate');
      const res = await PUT(
        jsonRequest(`${URL}/x`, 'PUT', {
          name: '',
          shortcut: 'translate',
          content: '本文',
        }),
        routeContext(target.id)
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('名前を入力してください');
    });
  });

  describe('異常系', () => {
    it('ID が UUID でなければ、DB に触れずに 400', async () => {
      const put = await PUT(
        jsonRequest(`${URL}/x`, 'PUT', {
          name: 'x',
          shortcut: 'x',
          content: 'x',
        }),
        routeContext('not-a-uuid')
      );
      expect(put.status).toBe(400);
      expect(await put.json()).toEqual({ error: '無効なテンプレートIDです' });

      const del = await DELETE(
        jsonRequest(`${URL}/x`, 'DELETE'),
        routeContext('not-a-uuid')
      );
      expect(del.status).toBe(400);
    });

    it('DB 側で置き換えに失敗すると 500 で、変えない', async () => {
      const target = await createTemplate('translate');
      await withFailingTemplates('UPDATE', async () => {
        const res = await PUT(
          jsonRequest(`${URL}/x`, 'PUT', {
            name: '新しい名前',
            shortcut: 'translate',
            content: '本文',
          }),
          routeContext(target.id)
        );
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
          error: 'テンプレートの更新に失敗しました',
        });
      });
      expect(
        (await prisma.promptTemplate.findUnique({ where: { id: target.id } }))
          ?.name
      ).toBe('translate');
    });

    it('DB 側で削除に失敗すると 500 で、残る', async () => {
      const target = await createTemplate('translate');
      await withFailingTemplates('DELETE', async () => {
        const res = await DELETE(
          jsonRequest(`${URL}/x`, 'DELETE'),
          routeContext(target.id)
        );
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
          error: 'テンプレートの削除に失敗しました',
        });
      });
      expect(await prisma.promptTemplate.count()).toBe(1);
    });
  });
});

describe('POST /api/prompt-templates/examples', () => {
  describe('正常系', () => {
    it('一覧が空なら例の 3 件を作り、ショートカットの昇順で返す', async () => {
      const res = await POST_EXAMPLES();
      expect(res.status).toBe(201);
      const { templates } = await res.json();
      expect(templates.map((t: { shortcut: string }) => t.shortcut)).toEqual([
        'review',
        'summarize',
        'translate',
      ]);
      expect(await prisma.promptTemplate.count()).toBe(3);
    });
  });

  describe('準正常系', () => {
    it('二度目は 409 で、何も足さない', async () => {
      await POST_EXAMPLES();
      const res = await POST_EXAMPLES();
      expect(res.status).toBe(409);
      expect(typeof (await res.json()).error).toBe('string');
      expect(await prisma.promptTemplate.count()).toBe(3);
    });

    it('同時に 2 回届いても 3 件だけ作る', async () => {
      const results = await Promise.all([POST_EXAMPLES(), POST_EXAMPLES()]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.promptTemplate.count()).toBe(3);
    });

    it('利用者のテンプレートが 1 件でもあれば 409', async () => {
      await createTemplate('mine');
      const res = await POST_EXAMPLES();
      expect(res.status).toBe(409);
      expect(await prisma.promptTemplate.count()).toBe(1);
    });
  });

  describe('異常系', () => {
    it('DB 側で作成に失敗すると 500 で、1 件も残さない', async () => {
      await withFailingTemplates('INSERT', async () => {
        const res = await POST_EXAMPLES();
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
          error: '例のテンプレートの作成に失敗しました',
        });
      });
      expect(await prisma.promptTemplate.count()).toBe(0);
    });
  });
});
