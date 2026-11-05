import { describe, it, expect } from 'vitest';
import { readOllamaResponse } from '@/lib/agent/agent';
import { OllamaStreamError } from '@/lib/llm/ollama';

/**
 * Ollama の応答の NDJSON を組み立てる。
 *
 * @param lines - 各行（オブジェクトは JSON にし、文字列はそのまま置く）
 * @returns 応答
 */
function ndjson(lines: (object | string)[]): Response {
  const body = lines
    .map((line) => (typeof line === 'string' ? line : JSON.stringify(line)))
    .join('\n');
  return new Response(body + '\n');
}

/**
 * 応答を読み、渡された本文と思考を集める。
 *
 * @param response - 読む応答
 * @returns 集めた本文・思考と、読み取りの例外
 */
async function read(response: Response) {
  const collected: { text: string; thinking: string; error?: unknown } = {
    text: '',
    thinking: '',
  };
  try {
    await readOllamaResponse(
      response,
      (text) => {
        collected.text += text;
      },
      (thinking) => {
        collected.thinking += thinking;
      }
    );
  } catch (error) {
    collected.error = error;
  }
  return collected;
}

const message = (fields: object) => ({
  model: 'test',
  message: { role: 'assistant', content: '', ...fields },
  done: false,
});

describe('Ollama のストリームの途中のエラー', () => {
  describe('正常系', () => {
    it('error の行が無ければ、本文を読んで終わる', async () => {
      const read1 = await read(
        ndjson([
          message({ content: 'こんにちは、世界です' }),
          {
            model: 'test',
            message: { role: 'assistant', content: '' },
            done: true,
          },
        ])
      );

      expect(read1.error).toBeUndefined();
      expect(read1.text).toBe('こんにちは、世界です');
    });
  });

  describe('準正常系', () => {
    it('error の前に届いた本文・思考を渡してから投げる', async () => {
      const read1 = await read(
        ndjson([
          message({ thinking: '調べる' }),
          message({ content: '途中までの本文です' }),
          { error: 'unexpected EOF' },
        ])
      );

      expect(read1.thinking).toBe('調べる');
      expect(read1.text).toBe('途中までの本文です');
      expect(read1.error).toBeInstanceOf(OllamaStreamError);
    });

    it('JSON として読めない行は無視して読み続ける', async () => {
      const read1 = await read(
        ndjson(['{壊れた行', { error: 'XML syntax error' }])
      );

      expect(read1.error).toBeInstanceOf(OllamaStreamError);
    });
  });

  describe('異常系', () => {
    it('思考だけの後に error が届いても、空の応答にせず投げる', async () => {
      const read1 = await read(
        ndjson([
          message({ thinking: 'delegate_to_agent を使う' }),
          { error: 'XML syntax error on line 3: unexpected EOF' },
        ])
      );

      expect(read1.thinking).toBe('delegate_to_agent を使う');
      expect(read1.error).toBeInstanceOf(OllamaStreamError);
      expect((read1.error as Error).message).toContain(
        'XML syntax error on line 3: unexpected EOF'
      );
    });
  });
});
