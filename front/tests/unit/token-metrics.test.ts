import { describe, it, expect } from 'vitest';
import type { OllamaStreamChunk } from '@/lib/llm/ollama';
import type { ResponseMetrics } from '@/types/chat/metrics';
import { addMetrics, metricsFromDoneChunk } from '@/lib/llm/metrics';
import {
  formatCount,
  formatSeconds,
  metricsDetails,
  metricsSummary,
  tokensPerSecond,
} from '@/lib/chat/response-metrics';
import { parseMessageMetadata } from '@/lib/chat/message-metadata';

/**
 * 応答のトークン数・所要時間（#31。`docs/19-token-metrics.md`）の純ロジックの UT。
 *
 * Ollama の終わりのチャンクの変換・ラウンドの合計・表示の文字列・保存済みの値の検証を確かめる。
 * ストリームでの受け渡しは IT（chat.test.ts・chat-agent.test.ts）、表示は E2E が担う。
 */

/**
 * Ollama の終わりのチャンクを作る。
 *
 * @param fields - 足す値（トークン数・ナノ秒の時間）
 * @returns 終わりのチャンク
 */
function doneChunk(fields: Partial<OllamaStreamChunk> = {}): OllamaStreamChunk {
  return {
    model: 'qwen3.8:27b',
    message: { role: 'assistant', content: '' },
    done: true,
    ...fields,
  };
}

/**
 * 応答 1 回分の値を作る。
 *
 * @param fields - 上書きする項目
 * @returns 値
 */
function metrics(fields: Partial<ResponseMetrics> = {}): ResponseMetrics {
  return {
    model: 'qwen3.8:27b',
    calls: 1,
    promptTokens: 1_204,
    promptCachedTokens: 1_180,
    maxPromptTokens: 1_204,
    promptDurationMs: 312,
    outputTokens: 312,
    outputDurationMs: 7_410,
    loadDurationMs: 3,
    totalDurationMs: 7_800,
    ...fields,
  };
}

describe('正常系', () => {
  it('終わりのチャンクを、ミリ秒の時間の値にする', () => {
    expect(
      metricsFromDoneChunk(
        doneChunk({
          prompt_eval_count: 44,
          prompt_eval_cached_count: 43,
          prompt_eval_duration: 4_500_000,
          eval_count: 10,
          eval_duration: 40_729_000,
          load_duration: 2_178_500,
          total_duration: 49_039_916,
        })
      )
    ).toEqual({
      model: 'qwen3.8:27b',
      calls: 1,
      promptTokens: 44,
      promptCachedTokens: 43,
      maxPromptTokens: 44,
      promptDurationMs: 4.5,
      outputTokens: 10,
      outputDurationMs: 40.729,
      loadDurationMs: 2.1785,
      totalDurationMs: 49.039916,
    });
  });

  it('ラウンドの値は足し、文脈の大きさは大きい方を取る', () => {
    const first = metrics({ promptTokens: 1_000, maxPromptTokens: 1_000 });
    const second = metrics({ promptTokens: 1_200, maxPromptTokens: 1_200 });
    expect(addMetrics(first, second)).toEqual({
      model: 'qwen3.8:27b',
      calls: 2,
      promptTokens: 2_200,
      promptCachedTokens: 2_360,
      maxPromptTokens: 1_200,
      promptDurationMs: 624,
      outputTokens: 624,
      outputDurationMs: 14_820,
      loadDurationMs: 6,
      totalDurationMs: 15_600,
    });
  });

  it('要約はトークン数と 0.1 トークン/秒単位の速さ', () => {
    expect(metricsSummary(metrics())).toBe('312 トークン · 42.1 トークン/秒');
  });

  it('数は 3 桁ごとに区切り、時間は 0.1 秒単位にする', () => {
    expect(formatCount(1_204)).toBe('1,204');
    expect(formatCount(12.6)).toBe('13');
    expect(formatSeconds(7_410)).toBe('7.4 秒');
    expect(formatSeconds(40)).toBe('0.0 秒');
  });

  it('内訳はモデル・出力・入力（キャッシュ）・Ollama の中の時間', () => {
    expect(metricsDetails(metrics())).toEqual([
      { label: 'モデル', value: 'qwen3.8:27b' },
      { label: '出力', value: '312 トークン（思考を含む）・7.4 秒' },
      { label: '入力', value: '1,204 トークン（キャッシュ 1,180）・0.3 秒' },
      { label: 'Ollama の中の時間', value: '7.8 秒' },
    ]);
  });

  it('複数の問い合わせの合計なら最大の文脈を、読み込みに 0.5 秒以上かかったら読み込みの時間を出す', () => {
    const labels = metricsDetails(
      metrics({ calls: 3, loadDurationMs: 2_800 })
    ).map((row) => row.label);
    expect(labels).toEqual([
      'モデル',
      '出力',
      '入力',
      '最大の文脈',
      'モデルの読み込み',
      'Ollama の中の時間',
    ]);
  });

  it('保存済みの値を読み戻す', () => {
    const saved = metrics();
    expect(parseMessageMetadata({ metrics: saved })).toEqual({
      metrics: saved,
    });
  });
});

describe('準正常系', () => {
  it('入力・時間の値が届かなければ 0 にする（出力の値があれば持つ）', () => {
    expect(
      metricsFromDoneChunk(doneChunk({ eval_count: 5, eval_duration: 1e8 }))
    ).toMatchObject({
      promptTokens: 0,
      promptCachedTokens: 0,
      promptDurationMs: 0,
      loadDurationMs: 0,
      totalDurationMs: 0,
      outputTokens: 5,
      outputDurationMs: 100,
    });
  });

  it('片方が無ければ、もう片方をそのまま合計にする', () => {
    const only = metrics();
    expect(addMetrics(undefined, only)).toBe(only);
    expect(addMetrics(only, undefined)).toBe(only);
    expect(addMetrics(undefined, undefined)).toBeUndefined();
  });

  it('生成の時間が 0 なら速さを出さず、トークン数だけにする', () => {
    const instant = metrics({ outputTokens: 1, outputDurationMs: 0 });
    expect(tokensPerSecond(instant)).toBeUndefined();
    expect(metricsSummary(instant)).toBe('1 トークン');
  });

  it('キャッシュが 0 なら入力にキャッシュを書かない', () => {
    const [, , input] = metricsDetails(metrics({ promptCachedTokens: 0 }));
    expect(input).toEqual({ label: '入力', value: '1,204 トークン・0.3 秒' });
  });

  it('値の形が合わなければ metrics だけを捨て、ほかの項目は読む', () => {
    expect(
      parseMessageMetadata({
        agentRounds: 2,
        metrics: { ...metrics(), outputTokens: -1 },
      })
    ).toEqual({ agentRounds: 2 });
  });
});

describe('異常系', () => {
  it.each([
    ['出力のトークン数が無い', { eval_duration: 1e8 }],
    ['生成の時間が無い', { eval_count: 5 }],
    ['出力のトークン数が数でない', { eval_count: '5', eval_duration: 1e8 }],
    ['生成の時間が負', { eval_count: 5, eval_duration: -1 }],
  ])('%s終わりのチャンクは値を持たない', (_, fields) => {
    // 外から届く値を、型を偽って渡す（数でない値を確かめるため）
    expect(
      metricsFromDoneChunk(doneChunk(fields as Partial<OllamaStreamChunk>))
    ).toBeUndefined();
  });

  it.each([
    ['オブジェクトでない', '312 トークン'],
    ['モデルが空', { ...metrics(), model: '' }],
    ['問い合わせの数が 0', { ...metrics(), calls: 0 }],
    ['問い合わせの数が整数でない', { ...metrics(), calls: 1.5 }],
    ['トークン数が文字列', { ...metrics(), promptTokens: '1204' }],
    ['時間が無限大', { ...metrics(), totalDurationMs: Infinity }],
    ['項目が欠けている', { model: 'qwen3.8:27b', calls: 1 }],
  ])('保存済みの値が%sなら捨てる', (_, value) => {
    expect(parseMessageMetadata({ metrics: value })).toBeNull();
  });
});
