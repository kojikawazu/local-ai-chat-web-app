import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/models/route';
import { stubFetch } from './helpers/ollama-stub';

/**
 * `/api/models` の IT。Ollama `/api/tags` を fetch スタブし、モデル一覧取得の
 * 正常応答と、接続失敗時の 502 契約（E2E から移譲）を検証する。DB 非依存。
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/models', () => {
  describe('正常系', () => {
    it('Ollama のモデル一覧を名前配列＋既定モデルで返す', async () => {
      stubFetch(
        () =>
          new Response(
            JSON.stringify({ models: [{ name: 'qwen2.5:0.5b' }, { name: 'llama3' }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      );

      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.models).toEqual(['qwen2.5:0.5b', 'llama3']);
      expect(typeof body.defaultModel).toBe('string');
    });
  });

  describe('準正常系', () => {
    it('モデルが 0 件でも 200 と空配列を返す', async () => {
      stubFetch(
        () => new Response(JSON.stringify({ models: [] }), { status: 200 }),
      );

      const res = await GET();
      expect(res.status).toBe(200);
      expect((await res.json()).models).toEqual([]);
    });
  });

  describe('異常系', () => {
    it('Ollama への接続に失敗すると 502 を返す', async () => {
      stubFetch(() => {
        throw new Error('ECONNREFUSED');
      });

      const res = await GET();
      expect(res.status).toBe(502);
    });

    it('Ollama が非 2xx を返すと 502 を返す', async () => {
      stubFetch(() => new Response('nope', { status: 500 }));

      const res = await GET();
      expect(res.status).toBe(502);
    });
  });
});
