import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { sendMessage } from './test-data';

/**
 * 実際の Ollama に長い応答を生成させ、生成中の状態を作るヘルパー（#8・#9）。
 *
 * 停止（`streaming-stop.spec.ts`）や、生成中に押させない操作（`regenerate.spec.ts`）の検証に使う。
 */

/**
 * 止める前に終わらないよう、十分に長い応答を求める。qwen2.5:0.5b で 300 トークン以上の応答に
 * なる割合が最も高かった（15 回中 14 回。「1 から 500 まで数えて」は 7 回で、短く省略しがち）
 */
export const LONG_PROMPT =
  '日本の歴史について、縄文時代から令和まで、各時代を詳しく、できるだけ長く説明してください。';

/** 応答が短く終わって止められなかったときに送り直す上限（15 回に 1 回の短い応答を吸収する） */
const MAX_SEND_ATTEMPTS = 3;

/**
 * 生成中に出る停止ボタン。
 *
 * @param page - 対象のページ
 * @returns 停止ボタンのロケーター
 */
export function stopButton(page: Page) {
  return page.getByRole('button', { name: '生成を停止' });
}

/**
 * 長い応答を生成させ、本文が出始めて生成中のところまで進める。開いているページの会話で送る。
 *
 * 軽量モデルはまれに短く答えて、止める前に生成を終える。その場合は同じ会話で送り直す
 * （モデルの出力の長さはテストから制御できないため）。
 *
 * @param page - 対象のページ（送信できる状態まで開いておく）
 * @throws {Error} {@link MAX_SEND_ATTEMPTS} 回送っても、生成中の状態にならなかった場合
 */
export async function startLongAnswer(page: Page) {
  const answers = page.locator('.prose-nord');
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    const before = await answers.count();
    await sendMessage(page, LONG_PROMPT);
    // 本文の描画領域は最初の文字が届いた時点で現れる
    await expect(answers).toHaveCount(before + 1, { timeout: 120000 });
    if (await stopButton(page).isVisible()) return;
  }
  throw new Error(`${MAX_SEND_ATTEMPTS} 回送っても、止める前に応答が終わった`);
}
